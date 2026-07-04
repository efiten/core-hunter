// Pure transmitter-location estimation from (lat, lon, rssi, acc_m) receive
// points. RSSI-weighted centroid + kernel-density heatmap; no TX-power
// calibration, no DOM/Leaflet. See docs/superpowers/specs/2026-06-30-rssi-locate-design.md.

const R_EARTH_M = 6371000
// Receptions at or above this RSSI (dBm) are treated as "on top of the node" and
// weighted equally. Validated against 9 known-location repeaters: a plain linear
// ramp let a crowd of weak far receptions out-vote the few loud near ones (mean
// error 1309 m); linear-power weighting cut that to ~671 m. The cap saturates
// physically-implausible strong outliers (e.g. a mislabeled -22 dBm sample at
// 2.3 km) so a single bad-GPS point can't seize the whole estimate, while leaving
// legitimate on-top readings (-50..-56 dBm seen in the field) unclipped.
const RSSI_CAP = -55

// Great-circle distance in metres between two {lat, lon}.
export function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// RSSI (dBm) -> weight proportional to linear received power (10x per 10 dB),
// normalized so the cap maps to 1.0 and weaker receptions fade toward 0. This
// makes the loud near samples dominate the weighted centroid instead of being
// averaged away by the weak-signal crowd. 0 for null/NaN.
export function rssiWeight(rssi) {
  if (rssi == null || Number.isNaN(rssi)) return 0
  const clamped = Math.min(rssi, RSSI_CAP)
  return 10 ** ((clamped - RSSI_CAP) / 10)
}

// Map reception records to locate() input points, dropping any without GPS
// coordinates. The caller passes an already-filtered record set (sender / type
// / window / ignore), so locate estimates over exactly what the map plots.
export function toLocatePoints(records) {
  const points = []
  for (const r of records) {
    if (r.lat == null || r.lon == null) continue
    points.push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
  }
  return points
}

// RSSI-weighted centroid of [{lat,lon,rssi}]. null when total weight is 0.
export function weightedCentroid(points) {
  let sw = 0, slat = 0, slon = 0
  for (const p of points) {
    const w = rssiWeight(p.rssi)
    sw += w; slat += w * p.lat; slon += w * p.lon
  }
  if (sw === 0) return null
  return { lat: slat / sw, lon: slon / sw }
}

const OUTLIER_FACTOR = 4
// Never reject within the reception region: zero-hop LoRa (868 MHz) can reach
// 10–15 km in good conditions, so only a same-1-byte-prefix node well beyond
// that (a genuine collision) should ever be dropped. 20 km floor.
const MIN_OUTLIER_M = 20000
const DEFAULT_CELL_M = 10

// Median of a numeric array (0 for empty).
function median(xs) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const DEFAULT_COLS = 64
const DEFAULT_ROWS = 64

// Bounding box of points, padded by marginFrac on each side.
function boundsOf(points, marginFrac = 0.15) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat)
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon)
  }
  const dLat = (maxLat - minLat) || 0.001
  const dLon = (maxLon - minLon) || 0.001
  return {
    minLat: minLat - dLat * marginFrac, maxLat: maxLat + dLat * marginFrac,
    minLon: minLon - dLon * marginFrac, maxLon: maxLon + dLon * marginFrac,
  }
}

// RSSI-weighted Gaussian kernel-density grid, normalized 0..1. Each point adds
// weight * exp(-d^2 / 2sigma^2); sigma tightens for strong points (stronger -> a
// sharper hot spot). The grid bounds are the points' own bbox expanded by ~3*sigma
// so the border always sits in near-zero density — the cloud fades to transparent
// before the edge, leaving no rectangular artifact. Row 0 = minLat (south).
export function densityGrid(points, opts = {}) {
  const cols = opts.cols ?? DEFAULT_COLS
  const rows = opts.rows ?? DEFAULT_ROWS
  const grid = new Float32Array(rows * cols)
  if (!points.length) return { grid, rows, cols, bounds: boundsOf([{ lat: 0, lon: 0 }]) }
  // sigma from the points' OWN spread (not a margin-inflated box)
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat)
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon)
  }
  const spanM = haversineM({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon })
  const baseSigma = Math.max(spanM * 0.12, 30)
  // pad the box by 3*sigma so every border cell is >= 3 sigma from any point
  const padLat = (3 * baseSigma) / 111320
  const padLon = (3 * baseSigma) / (111320 * Math.cos((minLat * Math.PI) / 180))
  const bounds = {
    minLat: minLat - padLat, maxLat: maxLat + padLat,
    minLon: minLon - padLon, maxLon: maxLon + padLon,
  }
  let peak = 0
  for (let r = 0; r < rows; r++) {
    const lat = bounds.minLat + ((r + 0.5) / rows) * (bounds.maxLat - bounds.minLat)
    for (let c = 0; c < cols; c++) {
      const lon = bounds.minLon + ((c + 0.5) / cols) * (bounds.maxLon - bounds.minLon)
      let v = 0
      for (const p of points) {
        const w = rssiWeight(p.rssi)
        if (w === 0) continue
        const sigma = baseSigma * (1.1 - 0.6 * w) // strong -> tighter kernel
        const d = haversineM({ lat, lon }, p)
        v += w * Math.exp(-(d * d) / (2 * sigma * sigma))
      }
      grid[r * cols + c] = v
      if (v > peak) peak = v
    }
  }
  if (peak > 0) for (let i = 0; i < grid.length; i++) grid[i] /= peak
  return { grid, rows, cols, bounds }
}

// Convergence + geometry feedback. searchRadiusM = RSSI-weighted RMS distance to
// the centroid (shrinks as good data accumulates). encirclement = fraction of 8
// azimuth sectors around the centroid that contain a point (low = one-sided).
export function geometryStats(points, centroid) {
  if (!centroid || !points.length) {
    return { n: points.length, searchRadiusM: null, encirclement: 0 }
  }
  let sw = 0, swd2 = 0
  const sectors = new Array(8).fill(false)
  for (const p of points) {
    const w = rssiWeight(p.rssi)
    const d = haversineM(p, centroid)
    sw += w; swd2 += w * d * d
    const ang = Math.atan2((p.lon - centroid.lon) * Math.cos(centroid.lat * Math.PI / 180), p.lat - centroid.lat) // [-pi, pi]
    const sector = (Math.floor((ang + Math.PI) / (Math.PI / 4)) % 8 + 8) % 8
    sectors[sector] = true
  }
  const searchRadiusM = sw > 0 ? Math.sqrt(swd2 / sw) : null
  const encirclement = sectors.filter(Boolean).length / 8
  return { n: points.length, searchRadiusM, encirclement }
}

// Split points into inliers/outliers. Robust center = coordinate-wise median;
// outlier if distance > max(factor * medianDistance, floorM). This catches a
// lone far stray (a colliding 1-byte node) without flagging GPS jitter in a
// tight/stationary cluster (where MAD would collapse to 0).
export function rejectOutliers(points, opts = {}) {
  const factor = opts.factor ?? OUTLIER_FACTOR
  const floorM = opts.floorM ?? MIN_OUTLIER_M
  if (points.length < 3) return { inliers: points.slice(), outliers: [] }
  const center = {
    lat: median(points.map((p) => p.lat)),
    lon: median(points.map((p) => p.lon)),
  }
  const dists = points.map((p) => haversineM(p, center))
  const threshold = Math.max(factor * median(dists), floorM)
  const inliers = []
  const outliers = []
  points.forEach((p, i) => (dists[i] > threshold ? outliers : inliers).push(p))
  return { inliers, outliers }
}

// Spatial dedupe: collapse receptions within ~cellM metres to one representative
// (the strongest-RSSI sample in the cell). A stationary/parked hunter logs many
// near-identical points; without this they dominate the weight and collapse the
// estimate onto the parking spot. Driving points (usually > cellM apart) survive,
// preserving the geometry. Binning uses a local equirectangular projection.
export function dedupeSpatial(points, cellM = DEFAULT_CELL_M) {
  if (points.length < 2) return points.slice()
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((points[0].lat * Math.PI) / 180)
  const best = new Map()
  for (const p of points) {
    const cx = Math.round((p.lon * mPerDegLon) / cellM)
    const cy = Math.round((p.lat * mPerDegLat) / cellM)
    const key = cx + ':' + cy
    const cur = best.get(key)
    if (!cur || (p.rssi ?? -Infinity) > (cur.rssi ?? -Infinity)) best.set(key, p)
  }
  return [...best.values()]
}

// Full estimate from raw receive points [{lat,lon,rssi}]. Spatially dedupes
// (so a parked hunter doesn't dominate), rejects far-out collisions, then computes
// the weighted centroid, density heatmap and geometry stats over the inliers.
// centroid/heatmap are null when fewer than 3 inliers remain.
export function locate(points, opts = {}) {
  const deduped = dedupeSpatial(points, opts.cellM ?? DEFAULT_CELL_M)
  const { inliers, outliers } = rejectOutliers(deduped, opts)
  // strongest = the inlier heard loudest; the closest single sample to the node,
  // shown alongside the centroid (which the weak-signal crowd can pull off it).
  const strongest = inliers.length
    ? inliers.reduce((a, b) => ((b.rssi ?? -Infinity) > (a.rssi ?? -Infinity) ? b : a))
    : null
  if (inliers.length < 3) {
    return {
      centroid: null, heatmap: null, strongest, inliers, outliers,
      stats: { n: inliers.length, searchRadiusM: null, encirclement: 0 },
    }
  }
  const centroid = weightedCentroid(inliers)
  const heatmap = densityGrid(inliers, opts)
  const stats = geometryStats(inliers, centroid)
  return { centroid, heatmap, strongest, inliers, outliers, stats }
}
