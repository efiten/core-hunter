// app/ and web/ carry duplicate copies of locate.js and names.js. #238 asked
// whether to extract them into one shared module; the answer (2026-08-15) is
// no — neither deploy path can ship a file outside its own directory, since
// the app image builds with `app/` as its Docker context and the website
// deploys as a flat file list. So the copies stay, and these assertions are
// what makes a silent drift impossible instead of merely unlikely.
//
// This is the same guard signal.test.js already carries for the third copy.
// The failure being prevented is not hypothetical: #282 changed an opacity
// fallback on the web side only, and it survived review because the test that
// existed swept the named tiers and not the fallback.
import { describe, it, expect } from 'vitest'
import * as web from './locate.js'
import * as app from '../app/src/locate.js'
import * as webNames from './names.js'
import * as appNames from '../app/src/names.js'

// A spread-out set with a strong cluster, a weak fringe and one far outlier —
// enough to exercise dedupe, outlier rejection, the centroid, the grid and the
// sector stats rather than just their guard clauses.
const POINTS = [
  { lat: 51.0000, lon: 4.0000, rssi: -52 },
  { lat: 51.0004, lon: 4.0006, rssi: -58 },
  { lat: 51.0009, lon: 3.9994, rssi: -71 },
  { lat: 50.9993, lon: 4.0011, rssi: -84 },
  { lat: 51.0021, lon: 4.0025, rssi: -97 },
  { lat: 50.9975, lon: 3.9968, rssi: -113 },
  { lat: 51.0000, lon: 4.0000, rssi: -55 }, // same cell as the first -> dedupe
  { lat: 51.4000, lon: 4.9000, rssi: -101 }, // ~70 km away -> outlier candidate
]
const RECORDS = [
  { lat: 51, lon: 4, rssi: -80, sender_id: 'aa' },
  { lat: null, lon: 4, rssi: -80, sender_id: 'bb' },
  { lat: 51, lon: null, rssi: -80, sender_id: 'cc' },
]

describe('locate — parity between the app and web copies', () => {
  it('exports exactly the same set of names', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(app).sort())
  })

  it('maps records to locate points identically', () => {
    expect(web.toLocatePoints(RECORDS)).toEqual(app.toLocatePoints(RECORDS))
  })

  it('measures distance identically', () => {
    for (const p of POINTS) {
      expect(web.haversineM(POINTS[0], p)).toBeCloseTo(app.haversineM(POINTS[0], p), 9)
    }
  })

  // The weighting is the capped-power model behind every estimate; a drift
  // here moves centroids without changing anything visible in the code.
  it('weights RSSI identically across the scale, including the cap', () => {
    for (let rssi = -130; rssi <= -20; rssi++) {
      expect(web.rssiWeight(rssi)).toBe(app.rssiWeight(rssi))
    }
    expect(web.rssiWeight(null)).toBe(app.rssiWeight(null))
    expect(web.rssiWeight(NaN)).toBe(app.rssiWeight(NaN))
  })

  it('computes the same weighted centroid', () => {
    expect(web.weightedCentroid(POINTS)).toEqual(app.weightedCentroid(POINTS))
    expect(web.weightedCentroid([])).toEqual(app.weightedCentroid([]))
  })

  it('dedupes and rejects outliers identically', () => {
    expect(web.dedupeSpatial(POINTS, 10)).toEqual(app.dedupeSpatial(POINTS, 10))
    expect(web.rejectOutliers(POINTS, {})).toEqual(app.rejectOutliers(POINTS, {}))
  })

  it('produces the same density grid and geometry stats', () => {
    expect(web.densityGrid(POINTS, {})).toEqual(app.densityGrid(POINTS, {}))
    const c = app.weightedCentroid(POINTS)
    expect(web.geometryStats(POINTS, c)).toEqual(app.geometryStats(POINTS, c))
    expect(web.geometryStats([], null)).toEqual(app.geometryStats([], null))
  })

  it('returns the same full estimate, including the too-few-points shape', () => {
    expect(web.locate(POINTS)).toEqual(app.locate(POINTS))
    expect(web.locate(POINTS.slice(0, 2))).toEqual(app.locate(POINTS.slice(0, 2)))
    expect(web.locate([])).toEqual(app.locate([]))
  })
})

// names.js is deliberately NOT identical: the app queries its configured
// resolvers directly, the website proxies through /api/resolve. Only the
// matching and caching core is shared, and only that is pinned here — the
// resolution strategy is allowed to differ, which is exactly why the shared
// half needs the guard.
describe('names — parity of the shared matching core', () => {
  const IDS = [
    'a1', '4a', 'aa11', 'aa11bb22', 'aa11bb22cc33dd44',
    'f'.repeat(64), 'A1B2C3D4', 'not-hex', '', 'zz11', null, undefined, 42,
  ]

  it('agrees on what is a full pubkey', () => {
    for (const id of IDS) expect(webNames.isFullPubkey(id)).toBe(appNames.isFullPubkey(id))
  })

  it('agrees on what is resolvable at all', () => {
    for (const id of IDS) expect(webNames.isResolvableId(id)).toBe(appNames.isResolvableId(id))
  })

  it('keeps the shared core present on both sides', () => {
    for (const name of ['isFullPubkey', 'isResolvableId', 'cachedName', 'cachedPosition', 'resolveName']) {
      expect(webNames).toHaveProperty(name)
      expect(appNames).toHaveProperty(name)
    }
  })

  it('agrees that an unseen key is unknown, not absent', () => {
    // undefined = never looked up, null = looked up and had no name. The
    // difference drives whether a lookup is fired, so it has to match.
    expect(webNames.cachedName('deadbeef')).toBe(appNames.cachedName('deadbeef'))
    expect(webNames.cachedPosition('deadbeef')).toBe(appNames.cachedPosition('deadbeef'))
  })
})
