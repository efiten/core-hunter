import { describe, it, expect } from 'vitest'
import { haversineM, rssiWeight, weightedCentroid, toLocatePoints } from '../locate.js'

describe('toLocatePoints', () => {
  it('maps records to {lat,lon,rssi} and drops those missing coordinates', () => {
    const recs = [
      { lat: 51, lon: 4, rssi: -70 },
      { lat: null, lon: 4, rssi: -80 },
      { lat: 52, lon: undefined, rssi: -90 },
      { lat: 53, lon: 5, rssi: -60 },
    ]
    expect(toLocatePoints(recs)).toEqual([
      { lat: 51, lon: 4, rssi: -70 },
      { lat: 53, lon: 5, rssi: -60 },
    ])
  })
  it('is empty for an empty input', () => {
    expect(toLocatePoints([])).toEqual([])
  })
})

describe('haversineM', () => {
  it('is ~0 for identical points', () => {
    expect(haversineM({ lat: 51, lon: 4 }, { lat: 51, lon: 4 })).toBeCloseTo(0, 5)
  })
  it('matches a known ~111.2 km per degree of latitude', () => {
    const d = haversineM({ lat: 51, lon: 4 }, { lat: 52, lon: 4 })
    expect(d).toBeGreaterThan(111000)
    expect(d).toBeLessThan(111400)
  })
})

describe('rssiWeight', () => {
  it('saturates at the cap (-55 dBm) and above', () => {
    expect(rssiWeight(-55)).toBeCloseTo(1, 6)
    expect(rssiWeight(-30)).toBeCloseTo(1, 6) // stronger than cap -> still 1
  })
  it('falls off 10x per 10 dB below the cap (linear power)', () => {
    expect(rssiWeight(-65)).toBeCloseTo(0.1, 6)
    expect(rssiWeight(-75)).toBeCloseTo(0.01, 6)
  })
  it('is tiny but non-zero for very weak receptions', () => {
    const w = rssiWeight(-115)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1e-5)
  })
  it('returns 0 for null/NaN', () => {
    expect(rssiWeight(null)).toBe(0)
    expect(rssiWeight(NaN)).toBe(0)
  })
})

describe('weightedCentroid', () => {
  it('is the midpoint for two equal-RSSI points', () => {
    const c = weightedCentroid([
      { lat: 0, lon: 0, rssi: -80 },
      { lat: 2, lon: 4, rssi: -80 },
    ])
    expect(c.lat).toBeCloseTo(1, 6)
    expect(c.lon).toBeCloseTo(2, 6)
  })
  it('is pulled hard toward the stronger point (linear power)', () => {
    const c = weightedCentroid([
      { lat: 0, lon: 0, rssi: -40 }, // capped to -55 -> weight 1
      { lat: 10, lon: 0, rssi: -80 }, // weight 10^-2.5 ~= 0.00316
    ])
    // (1*0 + 0.00316*10)/1.00316 ~= 0.0315
    expect(c.lat).toBeCloseTo(0.0315, 4)
  })
  it('returns null only when every rssi is null/NaN', () => {
    expect(weightedCentroid([{ lat: 1, lon: 1, rssi: null }])).toBeNull()
  })
})

import { rejectOutliers } from '../locate.js'


describe('rejectOutliers', () => {
  const cluster = [
    { lat: 51.0000, lon: 4.0000, rssi: -70 },
    { lat: 51.0002, lon: 4.0001, rssi: -72 },
    { lat: 51.0001, lon: 4.0003, rssi: -75 },
    { lat: 50.9999, lon: 3.9998, rssi: -73 },
  ]

  it('flags a single far stray (colliding node) and keeps the cluster', () => {
    const stray = { lat: 51.5, lon: 4.6, rssi: -95 } // ~70 km away
    const { inliers, outliers } = rejectOutliers([...cluster, stray])
    expect(outliers).toHaveLength(1)
    expect(outliers[0]).toEqual(stray)
    expect(inliers).toHaveLength(4)
  })

  it('flags nothing for a tight stationary cluster (GPS jitter only)', () => {
    const { outliers } = rejectOutliers(cluster)
    expect(outliers).toHaveLength(0)
  })

  it('returns all inliers when fewer than 3 points', () => {
    const two = cluster.slice(0, 2)
    expect(rejectOutliers(two)).toEqual({ inliers: two, outliers: [] })
  })
})

import { densityGrid } from '../locate.js'
import { geometryStats } from '../locate.js'

describe('geometryStats', () => {
  const centroid = { lat: 51, lon: 4 }

  it('encirclement is low for one-sided sampling, high when surrounded', () => {
    const oneSide = [
      { lat: 51.01, lon: 4.00, rssi: -70 },
      { lat: 51.02, lon: 4.00, rssi: -70 },
      { lat: 51.03, lon: 4.00, rssi: -70 },
    ]
    const around = [
      { lat: 51.01, lon: 4.00, rssi: -70 },
      { lat: 50.99, lon: 4.00, rssi: -70 },
      { lat: 51.00, lon: 4.01, rssi: -70 },
      { lat: 51.00, lon: 3.99, rssi: -70 },
    ]
    expect(geometryStats(oneSide, centroid).encirclement).toBeLessThan(0.3)
    expect(geometryStats(around, centroid).encirclement).toBeGreaterThan(0.4)
  })

  it('search radius shrinks when points are closer to the centroid', () => {
    const far = [
      { lat: 51.05, lon: 4, rssi: -70 }, { lat: 50.95, lon: 4, rssi: -70 },
    ]
    const near = [
      { lat: 51.005, lon: 4, rssi: -70 }, { lat: 50.995, lon: 4, rssi: -70 },
    ]
    expect(geometryStats(near, centroid).searchRadiusM)
      .toBeLessThan(geometryStats(far, centroid).searchRadiusM)
  })

  it('returns null radius for no centroid', () => {
    expect(geometryStats([{ lat: 51, lon: 4, rssi: -70 }], null).searchRadiusM).toBeNull()
  })
})

describe('densityGrid', () => {
  const pts = [
    { lat: 51.000, lon: 4.000, rssi: -60 },
    { lat: 51.010, lon: 4.010, rssi: -90 },
    { lat: 50.990, lon: 3.990, rssi: -90 },
  ]

  it('returns a normalized grid of the requested size', () => {
    const { grid } = densityGrid(pts, { cols: 16, rows: 16 })
    expect(grid).toHaveLength(16 * 16)
    expect(Math.max(...grid)).toBeCloseTo(1, 6) // peak normalized to 1
    expect(Math.min(...grid)).toBeGreaterThanOrEqual(0)
  })

  it('peaks nearer the strongest-RSSI point', () => {
    const { grid, rows, cols, bounds } = densityGrid(pts, { cols: 16, rows: 16 })
    let best = 0, bi = 0
    grid.forEach((v, i) => { if (v > best) { best = v; bi = i } })
    const r = Math.floor(bi / cols), c = bi % cols
    const lat = bounds.minLat + ((r + 0.5) / rows) * (bounds.maxLat - bounds.minLat)
    const lon = bounds.minLon + ((c + 0.5) / cols) * (bounds.maxLon - bounds.minLon)
    // strongest point is at (51.000, 4.000); peak cell should be closer to it
    // than to the weak point at (51.010, 4.010)
    const dStrong = Math.hypot(lat - 51.0, lon - 4.0)
    const dWeak = Math.hypot(lat - 51.01, lon - 4.01)
    expect(dStrong).toBeLessThan(dWeak)
  })

  it('returns an all-zero grid for no points', () => {
    const { grid } = densityGrid([], { cols: 8, rows: 8 })
    expect(Math.max(...grid)).toBe(0)
  })

  // --- kernel interior (#370) ---------------------------------------------
  // The three tests above pin the grid's size, where it peaks and the empty
  // case. Everything the kernel actually does — how sigma is chosen, how far
  // the box is padded, how a strong reception differs from a weak one — could
  // be changed without any of them noticing. These pin that interior, and each
  // one is written so a single expression is load-bearing.
  //
  // bounds is what makes sigma observable at all: the box is padded by exactly
  // 3 * baseSigma, so reading the padding back out of the returned bounds
  // measures a value the function never returns directly.
  const padLatM = ({ bounds }, points) =>
    (bounds.maxLat - Math.max(...points.map((p) => p.lat))) * 111320

  it('floors sigma at 30 m, so a tight cluster does not collapse to a point', () => {
    // ~12 m across: spanM * 0.12 is ~1.4 m, far under the floor, so the floor
    // is the only thing deciding the kernel here.
    const tight = [
      { lat: 51, lon: 4, rssi: -60 },
      { lat: 51.00009, lon: 4.00009, rssi: -80 },
    ]
    // 3 * 30 m. A floor of 300 gives 900; a 1-sigma pad gives 30.
    expect(padLatM(densityGrid(tight, { cols: 8, rows: 8 }), tight)).toBeCloseTo(90, 0)
  })

  it('takes sigma from the points own spread once that beats the floor', () => {
    // ~4.83 km across, so sigma is 0.12 of it (580 m) and the floor is idle.
    const wide = [
      { lat: 51, lon: 4, rssi: -60 },
      { lat: 51.03, lon: 4.05, rssi: -80 },
    ]
    const pad = padLatM(densityGrid(wide, { cols: 8, rows: 8 }), wide)
    // 3 * 0.12 * 4833 m. Doubling the 0.12 gives 3480; a 1-sigma pad gives 580.
    expect(pad).toBeCloseTo(1740, -1)
    // And the floor is genuinely not in play, so this case pins the ratio
    // rather than the floor: raising 30 to 300 must not move this number.
    expect(pad / 3).toBeGreaterThan(300)
  })

  it('gives a strong reception a tighter kernel than a weak one', () => {
    // Identical geometry, so sigma is the only difference between the two
    // grids: baseSigma * (1.1 - 0.6 * w) is 0.5x at full weight and 1.1x at
    // none. Both peak at 1 after normalisation, so the falloff is what shows.
    const grid = (rssi) => densityGrid([{ lat: 51, lon: 4, rssi }], { cols: 9, rows: 9 }).grid
    const strong = grid(-30)   // w = 1
    const weak = grid(-110)    // w ~ 3e-6
    const cell = 4 * 9 + 6     // two cells off the peak, same place in both
    // Drop the tightening term and the two become the same grid, so this fails.
    expect(strong[cell]).toBeLessThan(weak[cell] / 10)
  })

  it('normalises the peak to exactly 1, whatever the absolute weights', () => {
    // Two sets whose raw densities differ by orders of magnitude: without the
    // final divide, only one of them could come out at 1.
    for (const rssi of [-30, -110]) {
      const { grid } = densityGrid([{ lat: 51, lon: 4, rssi }], { cols: 8, rows: 8 })
      expect(Math.max(...grid)).toBeCloseTo(1, 6)
    }
  })

  it('lets a reception with no RSSI contribute nothing', () => {
    // Pinned as behaviour, not as the `if (w === 0) continue` line: that guard
    // is a short-circuit, not a rule. rssiWeight already answers 0 for a null,
    // so the term it skips is `0 * exp(...)` and removing the guard changes no
    // output at all. What matters — and what this catches — is a change to
    // rssiWeight's null handling, which would silently place a point that
    // carries no signal information.
    const real = [{ lat: 51, lon: 4, rssi: -60 }, { lat: 51.01, lon: 4.01, rssi: -80 }]
    // Strictly inside the real points' own bounding box, so the padded bounds
    // are identical either way and the two grids are directly comparable. A
    // null point outside it would move the box and change every cell for a
    // reason that has nothing to do with weighting.
    const withNulls = [...real, { lat: 51.005, lon: 4.005, rssi: null }, { lat: 51.004, lon: 4.004, rssi: NaN }]
    const a = densityGrid(real, { cols: 8, rows: 8 })
    const b = densityGrid(withNulls, { cols: 8, rows: 8 })
    expect(b.bounds).toEqual(a.bounds)
    expect([...b.grid]).toEqual([...a.grid])
  })
})

import { locate } from '../locate.js'

describe('locate', () => {
  const pts = [
    { lat: 51.000, lon: 4.000, rssi: -60 },
    { lat: 51.002, lon: 4.001, rssi: -72 },
    { lat: 50.999, lon: 3.998, rssi: -75 },
    { lat: 51.001, lon: 4.003, rssi: -80 },
  ]

  it('produces a centroid, heatmap and stats for enough inliers', () => {
    const res = locate(pts)
    expect(res.centroid).toHaveProperty('lat')
    expect(res.heatmap.grid.length).toBeGreaterThan(0)
    expect(res.stats.n).toBe(4)
    expect(res.outliers).toHaveLength(0)
  })

  it('exposes the strongest-RSSI inlier (heard-loudest sample)', () => {
    const res = locate(pts)
    expect(res.strongest.rssi).toBe(-60)
    expect(res.strongest.lat).toBeCloseTo(51.0, 6)
  })

  it('separates a far stray into outliers and excludes it from the centroid', () => {
    const stray = { lat: 52.0, lon: 5.0, rssi: -95 }
    const res = locate([...pts, stray])
    expect(res.outliers).toContainEqual(stray)
    expect(res.centroid.lat).toBeLessThan(51.01) // stray did not drag it north
  })

  it('returns null centroid/heatmap when too few inliers', () => {
    const res = locate(pts.slice(0, 2))
    expect(res.centroid).toBeNull()
    expect(res.heatmap).toBeNull()
    expect(res.stats.searchRadiusM).toBeNull()
  })
})

import { dedupeSpatial } from '../locate.js'

describe('dedupeSpatial', () => {
  it('collapses co-located points to one, keeping the strongest RSSI', () => {
    const out = dedupeSpatial([
      { lat: 51, lon: 4, rssi: -80 },
      { lat: 51, lon: 4, rssi: -60 },
      { lat: 51, lon: 4, rssi: -90 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].rssi).toBe(-60)
  })
  it('keeps points more than a cell apart', () => {
    const out = dedupeSpatial([
      { lat: 51.00, lon: 4.00, rssi: -70 },
      { lat: 51.01, lon: 4.00, rssi: -70 }, // ~1.1 km north
      { lat: 51.00, lon: 4.01, rssi: -70 }, // ~0.7 km east
    ])
    expect(out).toHaveLength(3)
  })
  it('returns a copy for < 2 points', () => {
    const p = [{ lat: 51, lon: 4, rssi: -70 }]
    expect(dedupeSpatial(p)).toEqual(p)
  })
})

describe('rejectOutliers — 20 km reception-region floor', () => {
  const cluster = [
    { lat: 51.000, lon: 4.000, rssi: -70 },
    { lat: 51.001, lon: 4.000, rssi: -72 },
    { lat: 50.999, lon: 4.000, rssi: -73 },
  ]
  it('keeps a point 5 km out (within reception region)', () => {
    const far5 = { lat: 51.045, lon: 4.0, rssi: -95 } // ~5 km north
    expect(rejectOutliers([...cluster, far5]).outliers).toHaveLength(0)
  })
  it('flags a point 25 km out (a genuine far collision)', () => {
    const far25 = { lat: 51.225, lon: 4.0, rssi: -95 } // ~25 km north
    expect(rejectOutliers([...cluster, far25]).outliers).toEqual([far25])
  })
})

describe('locate — dedupe stops a parked hunter from dominating', () => {
  it('collapses a stationary stack and keeps an honest (non-tiny) search radius', () => {
    // Equal RSSI isolates dedupe's job (stopping 30 co-located samples from
    // dominating by count) from the power-weighting's strength preference.
    const parked = Array.from({ length: 30 }, () => ({ lat: 51.0, lon: 4.0, rssi: -70 }))
    const drive = [
      { lat: 51.02, lon: 4.00, rssi: -70 },
      { lat: 50.98, lon: 4.00, rssi: -70 },
      { lat: 51.00, lon: 4.03, rssi: -70 },
    ]
    const res = locate([...parked, ...drive])
    expect(res.inliers).toHaveLength(4) // 30 parked -> 1, + 3 drive
    expect(res.stats.searchRadiusM).toBeGreaterThan(500) // no collapse to 1-3 m
  })
})
