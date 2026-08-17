// app/ and web/ carry duplicate copies of locate.js and names.js. #238 asked
// whether to extract them into one shared module; the answer (2026-08-15) is
// no — neither deploy path can ship a file outside its own directory, since
// the app image builds with `app/` as its Docker context and the website
// deploys as a flat file list. So the copies stay, and these assertions are
// what makes a silent drift impossible instead of merely unlikely.
//
// A parity suite is only worth what its fixtures reach. The first version of
// this file passed 9 of 10 deliberate one-constant drifts, because every
// tunable was masked: the outlier threshold was floor-dominated, the dedupe
// cell was only exercised by exactly-coincident points, and the id set had no
// value at either regex boundary. Every fixture below is chosen so that one
// constant is load-bearing — if you add a case, make it fail for a reason.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as web from './locate.js'
import * as app from '../app/src/locate.js'
import * as webNames from './names.js'
import * as appNames from '../app/src/names.js'
import * as webCallout from './calloutPosition.js'
import * as appCallout from '../app/src/calloutPosition.js'
import { setConfig } from '../app/src/config.js'

// ~15 m and ~70 m north of the origin point: the first collapses under the
// 10 m default dedupe cell only if that default is still 10 m-ish, the second
// never does. Without a pair in this range, any cell size passes.
const M = 1 / 111320 // degrees latitude per metre
const POINTS = [
  { lat: 51.0000, lon: 4.0000, rssi: -52 },
  { lat: 51.0000 + 15 * M, lon: 4.0000, rssi: -55 }, // ~15 m: dedupe-cell sensitive
  { lat: 51.0000 + 70 * M, lon: 4.0000, rssi: -60 }, // ~70 m: never deduped
  { lat: 51.0004, lon: 4.0006, rssi: -58 },
  { lat: 51.0009, lon: 3.9994, rssi: -71 },
  { lat: 50.9993, lon: 4.0011, rssi: -84 },
  { lat: 51.0021, lon: 4.0025, rssi: -97 },
  { lat: 50.9975, lon: 3.9968, rssi: -113 },
  { lat: 51.0000, lon: 4.0000, rssi: -55 }, // exact duplicate of the first
]
// Straddles the 20 km outlier floor: one just inside, one just outside. With
// only a 70 km stray, any floor between 20 and 70 km passes unnoticed.
const NEAR_FLOOR = { lat: 51.0 + 19000 * M, lon: 4.0, rssi: -101 }
const PAST_FLOOR = { lat: 51.0 + 21000 * M, lon: 4.0, rssi: -101 }
const SPREAD = [...POINTS, NEAR_FLOOR, PAST_FLOOR]
// Even length, so median() takes its two-element branch.
const EVEN = SPREAD.slice(0, 10)
// Spread over tens of km, so the DEFAULT outlier threshold is factor-dominated
// rather than floor-dominated: the 60 km point is an outlier at factor 4 and an
// inlier at 12. Any tighter fixture leaves OUTLIER_FACTOR dead code.
const km = (n, rssi) => ({ lat: 51 + n * 1000 * M, lon: 4, rssi })
const WIDE = [km(0, -60), km(5, -70), km(10, -80), km(15, -90), km(20, -100), km(60, -101)]
// The mirror of WIDE, pinning the factor from BELOW: an even cluster out to
// 40 km with one stray at 60 km, which factor 4 keeps and factor 3 rejects.
// WIDE alone only catches a factor that grew.
const DOWN = [...[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((n) => km(n, -80)), km(60, -80)]

const RECORDS = [
  { lat: 51, lon: 4, rssi: -80, sender_id: 'aa' },
  { lat: 0, lon: 0, rssi: -80, sender_id: 'null-island' }, // 0 is a coordinate, not a miss
  { lat: null, lon: 4, rssi: -80, sender_id: 'bb' },
  { lat: 51, lon: null, rssi: -80, sender_id: 'cc' },
]

describe('locate — parity between the app and web copies', () => {
  // Asserted as a literal, not just set-equal: two copies that gain the same
  // untested function are "at parity" by construction, which is the false
  // confidence this whole file exists to avoid.
  it('exports exactly this set of names, all of it covered below', () => {
    const expected = ['dedupeSpatial', 'densityGrid', 'geometryStats', 'haversineM',
      'locate', 'rejectOutliers', 'rssiWeight', 'toLocatePoints', 'weightedCentroid']
    expect(Object.keys(web).sort()).toEqual(expected)
    expect(Object.keys(app).sort()).toEqual(expected)
  })

  it('maps records to locate points identically, including the null island', () => {
    expect(web.toLocatePoints(RECORDS)).toEqual(app.toLocatePoints(RECORDS))
    expect(web.toLocatePoints(RECORDS)).toHaveLength(2) // lat/lon 0 is kept
  })

  it('measures distance identically', () => {
    for (const p of SPREAD) {
      expect(web.haversineM(SPREAD[0], p)).toBeCloseTo(app.haversineM(SPREAD[0], p), 9)
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
    // 0 dBm is a real reading (19 of them in production) and the one value a
    // `!rssi` "simplification" of the null guard would silently zero out.
    expect(web.rssiWeight(0)).toBe(app.rssiWeight(0))
    expect(web.rssiWeight(0)).toBeGreaterThan(0)
  })

  it('computes the same weighted centroid', () => {
    expect(web.weightedCentroid(SPREAD)).toEqual(app.weightedCentroid(SPREAD))
    expect(web.weightedCentroid([])).toEqual(app.weightedCentroid([]))
  })

  it('dedupes identically, at the same default cell size', () => {
    expect(web.dedupeSpatial(POINTS)).toEqual(app.dedupeSpatial(POINTS)) // default cell
    expect(web.dedupeSpatial(POINTS, 10)).toEqual(app.dedupeSpatial(POINTS, 10))
    expect(web.dedupeSpatial(POINTS, 50)).toEqual(app.dedupeSpatial(POINTS, 50))
  })

  // Both tunables are pinned: an explicit tight threshold makes the factor
  // load-bearing (the default is floor-dominated for any realistic fixture),
  // and the two points straddling 20 km make the floor itself load-bearing.
  it('rejects outliers identically, at the same factor and floor', () => {
    expect(web.rejectOutliers(SPREAD, {})).toEqual(app.rejectOutliers(SPREAD, {}))
    expect(web.rejectOutliers(WIDE, {})).toEqual(app.rejectOutliers(WIDE, {})) // a grown factor keeps the 60 km stray
    expect(web.rejectOutliers(DOWN, {})).toEqual(app.rejectOutliers(DOWN, {})) // a shrunk factor rejects it
    expect(web.locate(WIDE)).toEqual(app.locate(WIDE))
    // Each copy's DEFAULTS against the other's EXPLICIT values: this pins the
    // constants themselves, not merely that the two agree with each other.
    expect(web.rejectOutliers(DOWN, {})).toEqual(app.rejectOutliers(DOWN, { factor: 4, floorM: 20000 }))
    expect(app.rejectOutliers(DOWN, {})).toEqual(web.rejectOutliers(DOWN, { factor: 4, floorM: 20000 }))
    expect(web.dedupeSpatial(POINTS)).toEqual(app.dedupeSpatial(POINTS, 10))
    expect(web.rejectOutliers(SPREAD, { factor: 2, floorM: 100 })).toEqual(app.rejectOutliers(SPREAD, { factor: 2, floorM: 100 }))
    expect(web.rejectOutliers(EVEN, {})).toEqual(app.rejectOutliers(EVEN, {})) // even-length median branch
  })

  it('produces the same density grid and geometry stats, empty input included', () => {
    expect(web.densityGrid(SPREAD, {})).toEqual(app.densityGrid(SPREAD, {}))
    expect(web.densityGrid([], {})).toEqual(app.densityGrid([], {}))
    expect(web.densityGrid([SPREAD[0]], {})).toEqual(app.densityGrid([SPREAD[0]], {})) // single-point bounds fallback
    const c = app.weightedCentroid(SPREAD)
    expect(web.geometryStats(SPREAD, c)).toEqual(app.geometryStats(SPREAD, c))
    expect(web.geometryStats([], null)).toEqual(app.geometryStats([], null))
  })

  it('returns the same full estimate, including the too-few-points shape', () => {
    expect(web.locate(SPREAD)).toEqual(app.locate(SPREAD))
    expect(web.locate(POINTS)).toEqual(app.locate(POINTS))
    expect(web.locate(SPREAD.slice(0, 2))).toEqual(app.locate(SPREAD.slice(0, 2)))
    expect(web.locate([])).toEqual(app.locate([]))
  })
})

// names.js is deliberately NOT identical: the app queries its configured
// resolvers directly, the website proxies through /api/resolve. Only the
// matching and caching core is shared, and only that is pinned here — the
// resolution strategy is allowed to differ, which is exactly why the shared
// half needs the guard.
describe('names — parity of the shared matching core', () => {
  // Values AT both regex boundaries. Without 3/63/65-hex ids, {4,64} -> {3,64}
  // and {64} -> {63,64} both pass, which is the drift most likely to happen.
  const IDS = [
    'a1', 'aaa', 'aa11', 'aa11bb22', 'aa11bb22cc33dd44',
    'f'.repeat(63), 'f'.repeat(64), 'f'.repeat(65),
    'A1B2C3D4', 'not-hex', '', 'zz11', null, undefined, 42,
  ]

  it('agrees on what is a full pubkey, at the length boundary', () => {
    for (const id of IDS) expect(webNames.isFullPubkey(id)).toBe(appNames.isFullPubkey(id))
    expect(webNames.isFullPubkey('f'.repeat(64))).toBe(true)
    expect(webNames.isFullPubkey('f'.repeat(63))).toBe(false)
  })

  it('agrees on what is resolvable at all, at both length boundaries', () => {
    for (const id of IDS) expect(webNames.isResolvableId(id)).toBe(appNames.isResolvableId(id))
    expect(webNames.isResolvableId('aa11')).toBe(true)
    expect(webNames.isResolvableId('aaa')).toBe(false)
    expect(webNames.isResolvableId('f'.repeat(65))).toBe(false)
  })

  it('keeps the shared core present on both sides', () => {
    for (const name of ['isFullPubkey', 'isResolvableId', 'cachedName', 'cachedPosition', 'resolveName']) {
      expect(webNames).toHaveProperty(name)
      expect(appNames).toHaveProperty(name)
    }
  })

  describe('the cache contract, exercised rather than assumed', () => {
    beforeEach(() => {
      webNames._resetNameCache()
      setConfig({ resolvers: [{ url: 'https://resolver.test/resolve' }] })
      // A definitive miss: the resolver answered, and it has no unique name.
      vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ name: '', ambiguous: false }) }))
    })
    afterEach(() => { vi.unstubAllGlobals(); setConfig(null) })

    it('reports an unseen key as undefined on both sides', () => {
      expect(webNames.cachedName('deadbeef')).toBeUndefined()
      expect(appNames.cachedName('deadbeef')).toBeUndefined()
      expect(webNames.cachedPosition('deadbeef')).toBeUndefined()
      expect(appNames.cachedPosition('deadbeef')).toBeUndefined()
    })

    // The distinction that matters to callers: `cachedName(id) === undefined`
    // is what map.js and app.js use to decide whether to fire a lookup, so a
    // key that resolved to nothing must NOT read as unseen — otherwise every
    // unknown id is refetched on every draw pass. The two copies store
    // different falsy sentinels ('' in the app, null in web); that difference
    // is invisible to every consumer, and pinned here as allowed.
    it('reports a resolved-but-unknown key as resolved, not unseen', async () => {
      const key = 'aa11bb22'
      await webNames.resolveName(key)
      await appNames.resolveName(key)
      expect(webNames.cachedName(key)).not.toBeUndefined()
      expect(appNames.cachedName(key)).not.toBeUndefined()
      expect(webNames.cachedName(key)).toBeFalsy()
      expect(appNames.cachedName(key)).toBeFalsy()
      expect(webNames.cachedPosition(key)).toBeNull()
      expect(appNames.cachedPosition(key)).toBeNull()
      // Case-folded on both sides: ids reach the cache from the API, the URL
      // and the packet decoder, which do not agree on case.
      expect(webNames.cachedName(key.toUpperCase())).toBe(webNames.cachedName(key))
      expect(appNames.cachedName(key.toUpperCase())).toBe(appNames.cachedName(key))
    })
  })
})

// calloutPosition.js is the fourth duplicated module (#316 gave web an
// onboarding overlay built on the app's spotlight geometry). Pure maths, so
// parity is checked by running the cases where a constant is load-bearing: each
// side, the align variants, and a target close enough to an edge that the
// clamp — not the requested position — decides the answer.
describe('calloutPosition — parity between the app and web copies', () => {
  const viewport = { width: 400, height: 800 }
  const size = { width: 150, height: 60 }
  const target = { left: 100, top: 200, right: 260, bottom: 240 }
  const CASES = [
    ['below/left', target, { side: 'below', align: 'left' }],
    ['below/right', target, { side: 'below', align: 'right' }],
    ['above', target, { side: 'above' }],
    ['left', target, { side: 'left' }],
    ['right', target, { side: 'right' }],
    // Clamped on every edge: without these, the margin and the viewport terms
    // are dead code and any of them could drift unnoticed.
    ['clamped top-left', { left: 2, top: 2, right: 20, bottom: 20 }, { side: 'above' }],
    ['clamped bottom-right', { left: 380, top: 780, right: 398, bottom: 798 }, { side: 'right' }],
    ['custom gap/margin', target, { side: 'below', gap: 24, margin: 40 }],
  ]
  it.each(CASES)('agrees on %s', (_label, rect, opts) => {
    expect(webCallout.calloutPosition(rect, viewport, size, opts))
      .toEqual(appCallout.calloutPosition(rect, viewport, size, opts))
  })

  it('agrees on sliding a box clear of the ones already placed', () => {
    const vp = { width: 1280, height: 800 }
    const b = (top, left, width = 200, height = 100) => ({ top, left, width, height })
    // Ordered so the far blocker is checked before the near one: the box is
    // pushed into a blocker it has already passed, which only the repeat pass
    // resolves. A single-sweep copy answers 188 here.
    for (const blockers of [[], [b(80, 0)], [b(250, 0), b(80, 0)], [b(100, 400)]]) {
      expect(webCallout.avoidOverlap(b(100, 0), blockers, vp))
        .toEqual(appCallout.avoidOverlap(b(100, 0), blockers, vp))
    }
    expect(webCallout.avoidOverlap(b(100, 0), [b(250, 0), b(80, 0)], vp)).toEqual({ top: 358, left: 0 })
  })

  it('agrees on the union of a control cluster', () => {
    const rects = [
      { left: 10, top: 10, right: 40, bottom: 30 },
      { left: 30, top: 50, right: 90, bottom: 70 },
    ]
    expect(webCallout.unionRect(rects)).toEqual(appCallout.unionRect(rects))
    expect(webCallout.unionRect(rects)).toEqual({ left: 10, top: 10, right: 90, bottom: 70, width: 80, height: 60 })
  })
})
