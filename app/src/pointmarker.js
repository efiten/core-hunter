// Octagon footprint for a single reception's 3D "pillar" marker (#250) — the
// fill-extrusion twin of a flat point. Originally a square (#250); rounded to
// an octagon (#308) so the pillar reads as the same marker as the flat 2D
// circle it replaces instead of a visibly different shape between view modes.
// Meter-scale, so the small-angle approximation (flat-earth over a few
// metres, longitude scaled by cos(lat)) is exact enough; no need for
// hexgrid.js's full Mercator projection, which exists there to keep hex cells
// aligned to the server's shared grid — a per-point marker footprint has no
// such alignment requirement.
const EARTH_RADIUS_M = 6378137
const OCTAGON_SIDES = 8

// Returns a closed [lon, lat] ring (9 points) approximating a circle of
// `radiusM` metres, centered on (lat, lon).
export function octagonRing(lat, lon, radiusM) {
  const latRad = lat * Math.PI / 180
  const ring = []
  for (let i = 0; i <= OCTAGON_SIDES; i++) {
    const angle = (i % OCTAGON_SIDES) * (2 * Math.PI / OCTAGON_SIDES)
    const northM = radiusM * Math.cos(angle)
    const eastM = radiusM * Math.sin(angle)
    const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI)
    const dLon = (eastM / EARTH_RADIUS_M) * (180 / Math.PI) / Math.cos(latRad)
    ring.push([lon + dLon, lat + dLat])
  }
  return ring
}

// MapLibre's zoom is defined against a 512 px world at z0, so ground resolution
// is (equatorial circumference x cos(lat)) / (512 x 2^zoom).
const EQUATOR_M = 2 * Math.PI * EARTH_RADIUS_M
export function metresPerPixel(lat, zoom) {
  return (EQUATOR_M * Math.cos(lat * Math.PI / 180)) / (512 * Math.pow(2, zoom))
}

// A pillar is a real-world object, so its footprint is metres — but a fixed
// metre size goes sub-pixel when zoomed out (~1 px at z14, which is the map's
// own initial zoom), leaving a hairline that cannot be seen or tapped. The flat
// circles these replace were zoom-invariant. Keep the true size where it is
// legible and only widen once it would fall below `minPx` on screen.
//
// Returns a CIRCUMRADIUS (centre → vertex), which is what octagonRing consumes.
// The square this replaced (#250) took the same number as an apothem
// (centre → edge), so the octagon is narrower across the flats by
// cos(pi/8) = 0.9239 for the same argument: a 4 px floor is 3.70 px across the
// flats and the painted area is 2*sqrt(2)*r^2 rather than 4*r^2, i.e. 29% less.
// That is accepted deliberately (#308) rather than divided out — the pillar is
// a marker, not a measurement, and a slightly slimmer one reads better against
// the hex cells underneath. The names say radius so the next reader is not
// left thinking it means half-width.
export function pillarRadiusM(lat, zoom, baseM, minPx) {
  const floor = minPx * metresPerPixel(lat, zoom)
  return floor > baseM ? floor : baseM
}

// Merge distance for coincident pillars (#402). 10 m is dedupeSpatial's cell
// (locate.js), reused deliberately: both answer "these samples are one place,
// not several", and a hunter standing still is exactly the case each was
// written for. Comfortably wider than the 3 m pillar radius, so anything left
// standing after a collapse cannot overlap its neighbour's footprint.
export const PILLAR_MERGE_M = 10

// Collapses receptions that share a position down to one pillar each (#402).
// Every record used to become its own octagon, so a stationary hunter's dozen
// samples drew a dozen coincident extrusions: coplanar side walls in a single
// depth pass, which z-fights — a column striped by tier colour, restriping as
// the camera moves. #302 made it louder rather than quieter, since translucent
// extrusions fight more visibly than opaque ones.
//
// Strongest sample wins, which is what buildHexFC and dedupeSpatial already do,
// and the survivor is the record itself at its own coordinates: this layer's
// whole point is showing where a reception actually was, so snapping it to a
// cell centre would trade one defect for a worse one. Keeping the record also
// keeps its id, so a tap still resolves through lastRecords to the log row it
// always did (#130, #309).
//
// Why not dedupeSpatial itself: it bins to a grid and keeps one per cell, which
// leaves the defect standing whenever a cluster straddles a cell boundary — two
// samples a metre apart, two cells, two overlapping pillars. For weighting an
// estimate that costs nothing; here it is the whole bug. So the grid is only an
// index: a record is dropped when a stronger survivor already sits within
// cellM, and the 3x3 neighbourhood is what makes the boundary case behave like
// the middle of a cell. Bounded work per record, unlike an all-pairs scan.
// Cell key for the collapse grid (#462). The 3x3 neighbourhood scan below runs
// per record, so a string key cost nine allocations each -- about 1.2M of them
// at the row counts a no-time-filter tick reaches.
//
// Packing two signed cell indices into one number is only collision-free while
// |cy| stays under half the multiplier, which is an invariant worth stating
// rather than leaving implicit: at the 10 m grid, lat +-90 puts |cy| at most
// ~1.00e6, against a 2^21 = 2.10e6 half-multiplier. The largest key a real
// coordinate can produce is ~8.4e12, comfortably inside Number.MAX_SAFE_INTEGER.
const CELL_KEY_MULT = 4194304 // 2^22
export function cellKey(cx, cy) { return cx * CELL_KEY_MULT + cy }

// A cheap identity for a record set, used to skip a collapse that would return
// the answer it already returned (#462). Count plus the id range: ids come from
// the IndexedDB store and only ever grow, so a set cannot change while keeping
// all three the same -- dropping a record inside the range changes the count,
// and adding one moves the maximum.
//
// Returns null when any record has no numeric id, which is the honest answer
// for "cannot be signed": the caller must then recompute rather than trust a
// signature that does not describe the data.
export function recordsSignature(records) {
  const rows = records || []
  let min = Infinity, max = -Infinity
  for (const r of rows) {
    const id = Number(r && r.id)
    if (!Number.isFinite(id)) return null
    if (id < min) min = id
    if (id > max) max = id
  }
  return rows.length + ':' + min + ':' + max
}

// createPillarCollapser wraps collapsePillars in that check. The collapse
// depends on the records alone -- not on zoom, not on the age fade, not on the
// plot offset -- so an unchanged set can reuse the previous answer wholesale,
// which is most ticks while parked. Everything that DOES change per tick (the
// ring geometry, the tier colour, the fade) is rebuilt by the caller on top of
// this, so nothing goes stale.
export function createPillarCollapser(cellM = PILLAR_MERGE_M) {
  let sig = null
  let out = []
  return function collapse(records) {
    const next = recordsSignature(records)
    if (next !== null && next === sig) return out
    sig = next
    out = collapsePillars(records, cellM)
    return out
  }
}

export function collapsePillars(records, cellM = PILLAR_MERGE_M) {
  const placed = records.filter((r) => r.lat != null && r.lon != null)
  if (placed.length < 2) return placed
  // Strongest first, so the record a cluster collapses onto is decided by
  // signal rather than by arrival order. Missing rssi sorts weakest instead of
  // dropping the record — no rssi still means it was heard here.
  const byStrength = [...placed].sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity))
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((placed[0].lat * Math.PI) / 180)
  const cellOf = (r) => [Math.round((r.lon * mPerDegLon) / cellM), Math.round((r.lat * mPerDegLat) / cellM)]
  const withinM = (a, b) => {
    const dx = (a.lon - b.lon) * mPerDegLon
    const dy = (a.lat - b.lat) * mPerDegLat
    return dx * dx + dy * dy <= cellM * cellM
  }
  // A list per cell, not one record: a 10 m cell is 14 m across the diagonal,
  // so two survivors legitimately share a cell whenever they sit in opposite
  // corners, and keying by cell alone would drop one of them.
  const kept = new Map()
  const out = []
  for (const r of byStrength) {
    const [cx, cy] = cellOf(r)
    let merged = false
    for (let dx = -1; dx <= 1 && !merged; dx++) {
      for (let dy = -1; dy <= 1 && !merged; dy++) {
        const near = kept.get(cellKey(cx + dx, cy + dy))
        if (near && near.some((k) => withinM(k, r))) merged = true
      }
    }
    if (merged) continue
    const key = cellKey(cx, cy)
    const cell = kept.get(key)
    if (cell) cell.push(r); else kept.set(key, [r])
    out.push(r)
  }
  return out
}
