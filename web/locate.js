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

// Map raw /api/points records (mixed senders/hunters -- whatever the current
// filter set matched, #176) to the {lat, lon, rssi} shape locate() needs,
// dropping any record missing a GPS fix. Mirrors the app's toLocatePoints.
export function toLocatePoints(records) {
  const points = []
  for (const r of records) {
    if (r.lat == null || r.lon == null) continue
    points.push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
  }
  return points
}

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
// Path-loss trilateration (#454). Backtested against nine repeaters whose real
// positions efite measured in the field: mean error 664 m for the weighted
// centroid this replaces, 211 m for this.
//
// The two answer different questions. A weighted centroid asks "where is the
// mass of strong receptions", so it lands wherever the hunter spent time near
// the node, and a drive that approached from one side puts it on that side. A
// path-loss fit asks "what position best explains the whole RSSI field",
// including the weak receptions -- the fall-off across the drive constrains the
// answer even where nobody drove.
//
// P0 is solved rather than assumed. For a candidate position each reception
// implies its own P0 = rssi + 10 n log10(d); if the candidate is right, they
// agree, and the spread of that disagreement is the cost. So no transmit power,
// antenna gain or height has to be known -- which is as well, since none of
// them is.
const PATHLOSS_EXPONENT = 2.4
// Free space is 2.0 and dense urban runs 3.5 or more, so this sits toward the
// open end. Chosen on the calibration set, where it is a broad optimum rather
// than a knife edge (2.2 -> 224 m, 2.4 -> 211 m, 2.6 -> 225 m), and fitting the
// exponent per node instead scored no better (220 m) while being free to chase
// noise. It is a fixed constant so a bad geometry cannot buy a good residual by
// inventing an implausible exponent.

// The model has nothing to say below this, so it is not asked. Ten metres is
// under a phone's own GPS accuracy, which means a reception "1 m away" and one
// "9 m away" are the same reception as far as anything here can tell -- and
// without the clamp the fit treats them as different evidence, chases the
// difference, and reports a confident rms on detail it cannot possibly know.
// It also keeps log10(0) out of the arithmetic.
const PATHLOSS_MIN_D_M = 10

function pathlossCost(points, lat, lon, n) {
  let sum = 0
  for (const p of points) {
    const d = Math.max(haversineM({ lat, lon }, p), PATHLOSS_MIN_D_M)
    sum += p.rssi + 10 * n * Math.log10(d)
  }
  const p0 = sum / points.length
  let err = 0
  for (const p of points) {
    const d = Math.max(haversineM({ lat, lon }, p), PATHLOSS_MIN_D_M)
    err += (p.rssi + 10 * n * Math.log10(d) - p0) ** 2
  }
  return err / points.length
}

// Coarse-to-fine rather than one fine grid: the cost surface is smooth, and
// this runs on the Locate tick. Five passes of 16x16 is 1,280 evaluations
// against 25,000 for a single 160x160 grid, for the same resolution.
export function pathlossFit(points, { exponent = PATHLOSS_EXPONENT, pad = 0.02 } = {}) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.rssi))
  if (pts.length < 3) return null
  let loLat = Math.min(...pts.map((p) => p.lat)) - pad
  let hiLat = Math.max(...pts.map((p) => p.lat)) + pad
  let loLon = Math.min(...pts.map((p) => p.lon)) - pad * 1.6
  let hiLon = Math.max(...pts.map((p) => p.lon)) + pad * 1.6
  let best = null
  for (let pass = 0; pass < 5; pass++) {
    const stepLat = (hiLat - loLat) / 16
    const stepLon = (hiLon - loLon) / 16
    let round = null
    for (let la = loLat; la <= hiLat; la += stepLat) {
      for (let lo = loLon; lo <= hiLon; lo += stepLon) {
        const cost = pathlossCost(pts, la, lo, exponent)
        if (!round || cost < round.cost) round = { cost, lat: la, lon: lo }
      }
    }
    if (!round) return null
    best = round
    loLat = best.lat - stepLat; hiLat = best.lat + stepLat
    loLon = best.lon - stepLon; hiLon = best.lon + stepLon
  }
  return { lat: best.lat, lon: best.lon, rmsDb: Math.sqrt(best.cost) }
}

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
  // The estimate is the path-loss fit when one can be made, and the weighted
  // centroid otherwise (#454). Backtested against nine repeaters whose real
  // positions were measured in the field: 681 m mean error for the centroid,
  // 210 m for the fit. Both are returned, because they disagree in a way worth
  // being able to see: the centroid marks where the strong receptions are, the
  // fit marks where the whole RSSI field says the transmitter is.
  //
  // Applied here and NOT in nodelayer.js's estimateFor, which runs once per
  // node in view every render tick. The fit costs about 90 ms on 600 points --
  // fine for one target on demand, far too slow per node per tick.
  const weighted = weightedCentroid(inliers)
  const fit = pathlossFit(inliers, opts)
  const centroid = fit || weighted
  const heatmap = densityGrid(inliers, opts)
  // Stats are measured against whatever the estimate ended up being, so
  // searchRadiusM keeps meaning "how spread out was our sampling around the
  // answer we are giving" rather than around one we are not.
  const stats = geometryStats(inliers, centroid)
  return { centroid, method: fit ? 'pathloss' : 'centroid', weighted, fit, heatmap, strongest, inliers, outliers, stats }
}
