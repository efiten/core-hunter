// The "Reach of one repeater" export (#720): one star of the reach layer on
// the export's cell (CELL_SIZE), as a 1200×1200 PNG. Where it was heard,
// where the hunters drove without hearing it, and what the repeater reaches
// in between. This module decides what goes on the image; exportrender.js
// draws it.
//
// What is filled in is thought from the repeater (Kasper, 27 September).
// The signal travels in straight lines, so there has to be a line from the
// repeater to a place it was heard before anything is filled. On that line
// a cell driven through without hearing it is a shadow: the line is reached
// from the repeater, or from a cell where it was heard, up to the next cell
// where it was heard, and not across a shadow. Heard at 1, 2 and 3, not at 4
// and 5, and again at 6, 7 and 8, fills 1 to 3 and 6 to 8. Between two
// neighbouring lines the area where both are reached is filled, out to their
// ends, when those lie close together and no silent cell lies in it. Terrain
// can be in the way too, so a cell is filled only where the repeater, up its
// mast, sees it over the ground; when the ground cannot be read, the lines
// alone decide. Heard and silent cells are measurements and are always
// drawn.
import { estimateFor } from './nodelayer.js'
import { hexCellAt, hexBoundary, hexSizeForRes } from './hexgrid.js'
import { rssiTier } from './signal.js'
import { RAY_ALT_M, starSelected } from './coverage.js'
import { kmBetween, starName, CELL_RES, CELL_SIZE } from './exportheard.js'

// Two neighbouring lines are close together when their ends lie within
// this; wider apart, the area between them is not filled. Chosen by Kasper
// on 27 September, from 2, 2.5, 3 and 3.5 km, for the fill as it was then;
// it holds for the lines.
export const REACH_EDGE_KM = 2
// A filled-in cell takes the inverse-distance mean of this many nearest
// hearings, so a crowd of strong hearings far off cannot outvote the weak
// ones next to it.
export const IDW_NEAREST = 6
// Antenna heights for the line of sight. Neither is known: the registry has
// no mast height, so the repeater's is the 30 m the 3D rays already leave
// from (RAY_ALT_M, coverage.js), and a hunter's antenna is on a car or in a
// hand.
export const REPEATER_MAST_M = RAY_ALT_M
export const HUNTER_ANTENNA_M = 1.5
// The standard atmosphere bends a radio path over the curve: the earth's
// radius times 4/3 is the usual effective radius. The Fresnel zone is not
// kept clear; this is the geometric line only.
const EFFECTIVE_R_M = 6371000 * (4 / 3)

// A local plane in km around `lat0`, enough at the scale of one repeater.
const planar = (lat0) => (p) => [p.lon * 111.32 * Math.cos((lat0 * Math.PI) / 180), p.lat * 110.574]

function inTriangle(p, [a, b, c], toXY) {
  const [px, py] = toXY(p), [ax, ay] = toXY(a), [bx, by] = toXY(b), [cx, cy] = toXY(c)
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
}

// idwRssi: the inverse-distance-squared mean of the IDW_NEAREST nearest
// hearings' RSSI at `at`.
export function idwRssi(at, hearings, k = IDW_NEAREST) {
  const near = hearings.map((h) => [kmBetween(at, h) ** 2 + 1e-9, h.rssi]).sort((a, b) => a[0] - b[0]).slice(0, k)
  let num = 0, den = 0
  for (const [d2, v] of near) { num += v / d2; den += 1 / d2 }
  return num / den
}

// lineOfSight: whether an antenna `fromM` above the ground at `from` sees
// one `toM` above the ground at `to` over the terrain, with the earth
// bulging between them. elevationAt(lat, lon) answers metres, or null for
// ground it did not read (off the tiles): that decides nothing, as no
// terrain at all decides nothing, rather than counting as sea level.
export function lineOfSight(from, to, elevationAt, { fromM = REPEATER_MAST_M, toM = HUNTER_ANTENNA_M, stepKm = 0.1 } = {}) {
  const e0 = elevationAt(from.lat, from.lon), e1 = elevationAt(to.lat, to.lon)
  if (e0 == null || e1 == null) return true
  const d = kmBetween(from, to) * 1000
  const steps = Math.max(2, Math.ceil(d / (stepKm * 1000)))
  const h0 = e0 + fromM, h1 = e1 + toM
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const ground = elevationAt(from.lat + (to.lat - from.lat) * t, from.lon + (to.lon - from.lon) * t)
    if (ground == null) continue
    const bulge = (t * d) * ((1 - t) * d) / (2 * EFFECTIVE_R_M)
    if (ground + bulge > h0 + (h1 - h0) * t) return false
  }
  return true
}

// sampleSteps: how finely a line is walked and an area sampled, in
// proportion to the cell at `res`: 80 m along a line and 0.0011° by 0.0017°
// over an area for the export's cell (CELL_SIZE, 360 Mercator units), all
// inside its inner radius on the ground up to about 65°N, so no cell is
// stepped over.
export function sampleSteps(res) {
  const k = hexSizeForRes(res) / CELL_SIZE
  return { walkKm: 0.08 * k, latDeg: 0.0011 * k, lonDeg: 0.0017 * k }
}

// walk: the cells a straight segment passes through, in order from `from`
// to `to`, each with how far along it lies in km (the middle of its part of
// the segment), sampled by sampleSteps.
function walk(from, to, res) {
  const total = kmBetween(from, to)
  const steps = Math.max(1, Math.ceil(total / sampleSteps(res).walkKm))
  const out = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const id = hexCellAt(from.lat + (to.lat - from.lat) * t, from.lon + (to.lon - from.lon) * t, res)
    const last = out[out.length - 1]
    if (last && last.id === id) last.b = t * total
    else out.push({ id, a: t * total, b: t * total })
  }
  return out.map(({ id, a, b }) => ({ id, km: (a + b) / 2 }))
}

// stretchesOf: the stretches of a line, as [from, to] in km from the
// repeater, that count as reached: from the repeater or a heard cell to the
// next heard cell, with no silent cell between. The repeater's own cell
// never darkens the line.
function stretchesOf(cells, heardBy, silentIds) {
  const out = []
  let from = 0
  cells.forEach(({ id, km }, i) => {
    if (i > 0 && silentIds.has(id)) { from = null; return }
    if (!heardBy.has(id)) return
    if (from != null) {
      const prev = out[out.length - 1]
      if (prev && prev[1] === from) prev[1] = km
      else out.push([from, km])
    }
    from = km
  })
  return out
}

const centreOf = (id) => {
  const r = hexBoundary(id).slice(0, 6)
  return { lat: r.reduce((s, q) => s + q[0], 0) / 6, lon: r.reduce((s, q) => s + q[1], 0) / 6 }
}
const ringOf = (id) => hexBoundary(id).map(([lat, lon]) => [lon, lat])

// lineCandidates: the cells on the reached stretches of the lines from the
// origin and in the areas between neighbouring ones (see the top of the
// file), before the terrain has its say. Heard and silent cells are never
// candidates.
function lineCandidates({ origin, heardBy, silentIds, res }) {
  const toXY = planar(origin.lat)
  const [ox, oy] = toXY(origin)
  const out = new Set()
  const lines = []
  const longest = new Map()   // cell id → the longest line through it, in km
  for (const { id, best } of heardBy.values()) {
    const total = kmBetween(origin, best)
    const cells = walk(origin, best, res)
    const stretches = stretchesOf(cells, heardBy, silentIds)
    for (const c of cells) {
      if (stretches.some(([a, b]) => c.km >= a && c.km <= b)) out.add(c.id)
      longest.set(c.id, Math.max(longest.get(c.id) || 0, total))
    }
    const [x, y] = toXY(best)
    lines.push({ id, end: best, total, stretches, a: Math.atan2(y - oy, x - ox) })
  }
  // A line to a cell a longer line passes through is part of that line, so
  // the areas are between the outer lines: heard at 1, 2 and 3 in a row is
  // one line with three places on it.
  const outer = lines.filter((l) => longest.get(l.id) <= l.total).sort((p, q) => p.a - q.a)
  const at = (l, km) => {
    const t = l.total ? km / l.total : 0
    return { lat: origin.lat + (l.end.lat - origin.lat) * t, lon: origin.lon + (l.end.lon - origin.lon) * t }
  }
  const silentCentres = [...silentIds].map(centreOf)
  const areas = []
  for (let i = 0; outer.length > 1 && i < outer.length; i++) {
    const A = outer[i], B = outer[(i + 1) % outer.length]
    let span = B.a - A.a
    if (span < 0) span += 2 * Math.PI
    if (span >= Math.PI) continue
    // From where both lines are reached out to the ends of their stretches:
    // from the repeater, that is the wedge between the two.
    for (const [a1, a2] of A.stretches) {
      for (const [b1, b2] of B.stretches) {
        const from = Math.max(a1, b1)
        if (from >= Math.min(a2, b2)) continue
        const quad = [at(A, from), at(A, a2), at(B, b2), at(B, from)]
        if (kmBetween(quad[1], quad[2]) > REACH_EDGE_KM) continue
        // From the repeater both near corners are the repeater: a triangle.
        const tris = from > 0 ? [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]] : [[quad[0], quad[1], quad[2]]]
        if (silentCentres.some((c) => tris.some((t) => inTriangle(c, t, toXY)))) continue
        areas.push(...tris)
      }
    }
  }
  if (areas.length) {
    const lats = areas.flat().map((p) => p.lat), lons = areas.flat().map((p) => p.lon)
    const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons)
    const seen = new Set()
    // Sampled finer than a cell, so every cell under an area is visited.
    const { latDeg, lonDeg } = sampleSteps(res)
    for (let lat = s; lat <= n + latDeg; lat += latDeg) {
      for (let lon = w; lon <= e + lonDeg; lon += lonDeg) {
        const id = hexCellAt(lat, lon, res)
        if (seen.has(id)) continue
        seen.add(id)
        if (areas.some((t) => inTriangle(centreOf(id), t, toXY))) out.add(id)
      }
    }
  }
  for (const id of heardBy.keys()) out.delete(id)
  for (const id of silentIds) out.delete(id)
  return out
}

// pickReachStar: the star "Reach of one repeater" draws, from the stars and
// the selected ids (the ▲ taps and the target rows). A merged target row is
// one repeater under ids where one starts the other (targetpicker.js), and
// its hearings can form two stars: that is one pick, and the star with the
// most hearings is drawn. Two picks answer { picked: 2 }, none { picked: 0 }.
export function pickReachStar(stars, selected) {
  const groups = []
  for (const id of [...selected].sort((a, b) => a.length - b.length)) {
    const g = groups.find((ids) => ids.some((x) => id.startsWith(x)))
    if (g) g.push(id); else groups.push([id])
  }
  const hits = groups.map((ids) => stars.filter((st) => starSelected(st, new Set(ids)))).filter((h) => h.length)
  if (hits.length !== 1) return { picked: hits.length }
  return { star: hits[0].reduce((best, st) => (st.points.length > best.points.length ? st : best)) }
}

// reachModel: what the image draws for one star (coverageStars' shape).
// `mapped` is every reception of the hunters in the window, for the cells
// they drove through; the star is named by starName (nameOf, cachedNameOf); elevationAt(lat,
// lon) reads the ground (exportterrain.js), null when it could not be
// read.
export function reachModel({ star, mapped, nameOf = () => null, cachedNameOf = () => null, elevationAt = null, estimate = estimateFor, res = CELL_RES }) {
  const pts = star.points
  const heardBy = new Map()
  for (const p of pts) {
    const id = hexCellAt(p.lat, p.lon, res)
    const c = heardBy.get(id)
    if (!c || p.rssi > c.best.rssi) heardBy.set(id, { id, best: p })
  }
  const heard = [...heardBy.values()].map(({ id, best }) => ({ id, ring: ringOf(id), rssi: best.rssi, tier: rssiTier(best.rssi) }))
  const from = { lat: star.origin.lat, lon: star.origin.lon }
  const rays = [...heardBy.values()].map(({ best }) => ({ from, lat: best.lat, lon: best.lon, tier: rssiTier(best.rssi) }))
  const dots = pts.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi, tier: rssiTier(p.rssi) }))

  const mappedIds = new Set()
  for (const p of mapped) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) mappedIds.add(hexCellAt(p.lat, p.lon, res))
  const silentIds = new Set([...mappedIds].filter((id) => !heardBy.has(id)))
  const silent = [...silentIds].map((id) => ({ id, ring: ringOf(id) }))

  const filled = []
  for (const id of lineCandidates({ origin: from, heardBy, silentIds, res })) {
    const c = centreOf(id)
    if (elevationAt && !lineOfSight(from, c, elevationAt)) continue
    const rssi = idwRssi(c, pts)
    filled.push({ id, ring: ringOf(id), rssi, tier: rssiTier(rssi) })
  }

  const est = estimate(pts.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi })))
  return {
    id: star.id,
    name: starName(star, { nameOf, cachedNameOf }),
    origin: star.origin,
    advertised: star.origin.kind === 'advertised' ? from : null,
    estimate: est && est.centroid ? { lat: est.centroid.lat, lon: est.centroid.lon } : null,
    heard, rays, dots, silent, filled,
    numbers: {
      receptions: pts.length,
      strongest: Math.max(...pts.map((p) => p.rssi)),
      farthestKm: Math.max(...pts.map((p) => kmBetween(from, p))),
    },
  }
}
