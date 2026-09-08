// app/ and web/ carry duplicate copies of the locate maths (web/locate.js,
// app/src/geometry.js) and of names.js. #238 asked whether to extract them
// into one shared module; the answer (2026-08-15) is no — neither deploy path
// can ship a file outside its own directory, since the app image builds with
// `app/` as its Docker context and the website deploys as a flat file list.
// So the copies stay, and these assertions are what makes a silent drift
// impossible instead of merely unlikely. Since #538 the app copy is a strict
// subset: locate() itself and toLocatePoints live only on the map, where
// Locate stayed; the shared maths below is still pinned function-for-function.
//
// A parity suite is only worth what its fixtures reach. The first version of
// this file passed 9 of 10 deliberate one-constant drifts, because every
// tunable was masked: the outlier threshold was floor-dominated, the dedupe
// cell was only exercised by exactly-coincident points, and the id set had no
// value at either regex boundary. Every fixture below is chosen so that one
// constant is load-bearing — if you add a case, make it fail for a reason.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as web from './locate.js'
import * as app from '../app/src/geometry.js'
import * as webNames from './names.js'
import * as appNames from '../app/src/names.js'
import * as webChangelog from './changelog.js'
import * as appChangelog from '../app/src/changelog.js'
import { FILTER_PACKET_TYPES as webTypes, packetTypeLabel as webPacketTypeLabel, SENDER_ID_CLASSES as webClasses, senderIdClass as webSenderIdClass } from './packettypes.js'
import { FILTER_PACKET_TYPES as appTypes, packetTypeLabel as appPacketTypeLabel, SENDER_ID_CLASSES as appClasses, senderIdClass as appSenderIdClass } from '../app/src/filters.js'
import * as webCallout from './calloutPosition.js'
import * as appCallout from '../app/src/calloutPosition.js'
import { initialSettingsTab as webInitialTab } from './settingssheet.js'
import { initialSettingsTab as appInitialTab } from '../app/src/settings.js'
import { setConfig } from '../app/src/config.js'
import { readFileSync } from 'node:fs'
import * as webLayer from './nodelayer.js'
import * as appLayer from '../app/src/nodelayer.js'
import * as webNotice from './nodeposnotice.js'
import * as appNotice from '../app/src/nodeposnotice.js'
import * as webTicker from './receptionticker.js'
import * as webLabels from './nodelabels.js'
import * as appLabels from '../app/src/nodelabels.js'
import * as appTicker from '../app/src/receptionlog.js'

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

describe('locate — parity between the app and web copies', () => {
  // Asserted as a literal, not just set-equal: two copies that gain the same
  // untested function are "at parity" by construction, which is the false
  // confidence this whole file exists to avoid.
  it('exports exactly this set of names, all of it covered below', () => {
    const shared = ['dedupeSpatial', 'densityGrid', 'geometryStats', 'haversineM',
      'pathlossFit', 'rejectOutliers', 'rssiWeight', 'weightedCentroid']
    // web keeps the two composed entry points the app dropped in #538; the
    // maths under them stays shared and is what the rest of this file pins.
    expect(Object.keys(web).sort()).toEqual([...shared, 'locate', 'toLocatePoints'].sort())
    expect(Object.keys(app).sort()).toEqual(shared)
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

  it('fits the same transmitter position from the same field', () => {
    // The estimator both copies now lead with (#454). A drift in the exponent
    // or in the search would move the answer by hundreds of metres on one
    // surface and not the other, which is the kind of divergence that only
    // shows up in the field.
    const w = web.pathlossFit(WIDE)
    const a = app.pathlossFit(WIDE)
    expect(w).toEqual(a)
    expect(w).not.toBeNull()
    expect(web.pathlossFit(POINTS.slice(0, 2))).toEqual(app.pathlossFit(POINTS.slice(0, 2)))
    expect(web.pathlossFit(POINTS.slice(0, 2))).toBeNull()
  })
})

// nodelabels.js is a verbatim copy on both sides (#539): the app's node
// layer has the same screen-space overlap problem the map solved in #425.
describe('nodelabels — parity between the app and web copies', () => {
  it('exports exactly the same names', () => {
    expect(Object.keys(appLabels).sort()).toEqual(Object.keys(webLabels).sort())
  })
  it('keeps and drops the same labels for the same screen items', () => {
    // Two overlapping at the same y, one clear below, one empty name: the
    // greedy walk must agree on every branch (kept, dropped, skipped).
    const items = [
      { id: 'a', x: 100, y: 200, label: 'NL-DR-GTN-OBS01' },
      { id: 'b', x: 140, y: 205, label: 'ON8AR' },
      { id: 'c', x: 100, y: 260, label: 'nl-dr-gtn-rp02' },
      { id: 'd', x: 300, y: 200, label: '' },
    ]
    expect(appLabels.unclutteredLabels(items)).toEqual(webLabels.unclutteredLabels(items))
    expect(appLabels.unclutteredLabels(items)).toEqual(['a', 'c'])
    expect(appLabels.labelBox(items[0])).toEqual(webLabels.labelBox(items[0]))
  })
  it('agrees on the fallback metrics', () => {
    expect(appLabels.LABEL_CHAR_PX).toBe(webLabels.LABEL_CHAR_PX)
    expect(appLabels.LABEL_HEIGHT_PX).toBe(webLabels.LABEL_HEIGHT_PX)
    expect(appLabels.LABEL_OFFSET_PX).toBe(webLabels.LABEL_OFFSET_PX)
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
    for (const name of ['isFullPubkey', 'isResolvableId', 'cachedName', 'cachedPosition', 'resolveName',
                        'resolvableKey', 'isHashIdKind']) {
      expect(webNames).toHaveProperty(name)
      expect(appNames).toHaveProperty(name)
    }
  })

  // Which kinds carry a 1-byte id as their own label. Drift here is silent and
  // ugly: one side marks "77" as an id, the other prints it as a name. The
  // false cases are what stop a `=> true` from passing.
  it('agrees on which sender kinds carry a hash as their label', () => {
    for (const k of ['direct_hash', 'path_hash', 'relay', 'advert_pubkey', 'discover_pubkey',
                     'channel_name', null, undefined, '']) {
      expect(webNames.isHashIdKind(k)).toBe(appNames.isHashIdKind(k))
    }
    expect(webNames.isHashIdKind('path_hash')).toBe(true)
    expect(webNames.isHashIdKind('direct_hash')).toBe(true)
    expect(webNames.isHashIdKind('relay')).toBe(false)
  })

  // resolvableKey is fill-only on both sides: a row that already has a name is
  // never looked up again, and a 1-byte id never at all.
  it('agrees on which receptions are worth resolving', () => {
    const recs = [
      { sender_id: 'aa11bb22cc33', sender_label: '' },
      { sender_id: 'aa11bb22cc33', sender_label: 'NEO7HI' },
      { sender_id: 'AA11', sender_label: null },
      { sender_id: '77', sender_label: '77' },
      { sender_id: null, sender_label: null },
      null,
    ]
    for (const r of recs) expect(webNames.resolvableKey(r)).toBe(appNames.resolvableKey(r))
    expect(webNames.resolvableKey(recs[0])).toBe('aa11bb22cc33')
    expect(webNames.resolvableKey(recs[1])).toBeNull()
    expect(webNames.resolvableKey(recs[2])).toBe('aa11')
    expect(webNames.resolvableKey(recs[3])).toBeNull()
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

// changelog.js (#284, rewritten for #422) is the third duplicated module. It
// stopped being a markdown parser and became the seen-state logic over a
// hand-written changelog.json, so parity is checked on the four decisions that
// have to agree — and the shipped data files are compared to each other too,
// since "one shared changelog" is physically two copies.

// web/packettypes.js and app/src/filters.js carry the same chip list on purpose
// (#142): filters.js has top-level DOM side effects, so web cannot import it.
// The list is what both surfaces filter by, and the server takes the values
// verbatim as ?types= — so a chip only one side knows is a filter that works
// on one map and silently returns nothing on the other. Nothing pinned this
// until #454 added a type to both copies.
describe('packet-type chips — parity between the app and web copies', () => {
  it('ships the same values in the same order', () => {
    expect(webTypes.map((t) => t.value)).toEqual(appTypes.map((t) => t.value))
  })

  it('labels each value identically, so one chip does not read as two things', () => {
    for (const { value } of appTypes) {
      expect(webPacketTypeLabel(value)).toBe(appPacketTypeLabel(value))
    }
  })

  it('falls back to the raw type identically for a value neither list knows', () => {
    expect(webPacketTypeLabel('NotAType')).toBe(appPacketTypeLabel('NotAType'))
  })

  // Sender-id classes (#475) travel the same way: the app buckets its own
  // records, the map sends the values verbatim as ?idclass= and the server
  // buckets in SQL. Three implementations of one rule, so a reception that
  // lands in different chips on two surfaces is the failure to guard against.
  it('ships the same sender-id classes, values and labels', () => {
    expect(webClasses.map((c) => c.value)).toEqual(appClasses.map((c) => c.value))
    expect(webClasses.map((c) => c.label)).toEqual(appClasses.map((c) => c.label))
  })

  it('buckets the same reception the same way, at every boundary', () => {
    const RECS = [
      { sender_id: '77', sender_kind: 'path_hash' },
      { sender_id: '4a', sender_kind: 'direct_hash' },
      { sender_id: 'a2a2', sender_kind: 'relay' },
      { sender_id: 'efef79', sender_kind: 'relay' },
      { sender_id: '7b0e24700e0c0d3e', sender_kind: 'discover_pubkey' },
      { sender_id: 'ab'.repeat(32), sender_kind: 'advert_pubkey' },
      // A channel whose id is 2 hex: the case that separates "kind first" from
      // "length first". Without it either order passes.
      { sender_id: 'ab', sender_kind: 'channel_name' },
      { sender_id: '', sender_kind: '' },
      { sender_id: null },
      {},
      null,
    ]
    for (const r of RECS) expect(webSenderIdClass(r)).toBe(appSenderIdClass(r))
    // Pinned absolutely too, so a matching drift on both sides still fails.
    expect(webSenderIdClass(RECS[0])).toBe('1b')
    expect(webSenderIdClass(RECS[2])).toBe('2b')
    expect(webSenderIdClass(RECS[3])).toBe('3b')
    expect(webSenderIdClass(RECS[4])).toBe('pubkey')
    expect(webSenderIdClass(RECS[6])).toBe('channel')
    expect(webSenderIdClass(RECS[7])).toBe('unnamed')
  })

  // Every value the chips can produce must be one the server accepts, or the
  // chip filters on one surface and returns nothing on the other.
  it('uses only values the server ?idclass= whitelist knows', () => {
    const SERVER_ACCEPTS = ['unnamed', '1b', '2b', '3b', 'pubkey', 'channel']
    expect(appClasses.map((c) => c.value).sort()).toEqual([...SERVER_ACCEPTS].sort())
  })
})

describe('changelog — parity between the app and web copies', () => {
  const ENTRIES = [
    { id: '2026-08-21-c', date: '2026-08-21', where: 'map', title: 'C', body: 'c' },
    { id: '2026-08-20-b', date: '2026-08-20', where: 'both', title: 'B', body: 'b' },
    { id: '2026-08-19-a', date: '2026-08-19', where: 'app', title: 'A', body: 'a' },
  ]

  it('exports exactly this set of names, all of it covered below', () => {
    const expected = ['hasUnseenEntries', 'migratedSeenId', 'unseenEntryCount', 'whereLabel']
    expect(Object.keys(webChangelog).sort()).toEqual(expected)
    expect(Object.keys(appChangelog).sort()).toEqual(expected)
  })

  it('agrees on the badge and the new-entry count', () => {
    // 'gone' is the case where the two answers deliberately differ, so a copy
    // that defined one in terms of the other would be caught here too.
    for (const seen of [null, '', '2026-08-19-a', '2026-08-21-c', 'gone']) {
      expect(webChangelog.hasUnseenEntries(ENTRIES, seen), String(seen))
        .toBe(appChangelog.hasUnseenEntries(ENTRIES, seen))
      expect(webChangelog.unseenEntryCount(ENTRIES, seen), String(seen))
        .toBe(appChangelog.unseenEntryCount(ENTRIES, seen))
    }
    // The values themselves, not just their agreement — two copies that both
    // returned 0 and false would "agree" perfectly.
    expect(webChangelog.unseenEntryCount(ENTRIES, '2026-08-19-a')).toBe(2)
    expect(webChangelog.hasUnseenEntries(ENTRIES, '2026-08-19-a')).toBe(true)
    expect(webChangelog.hasUnseenEntries(ENTRIES, null)).toBe(false)
  })

  it('agrees on the surface label, including a value neither knows', () => {
    for (const where of ['app', 'map', 'both', 'nonsense', undefined]) {
      expect(webChangelog.whereLabel(where), String(where)).toBe(appChangelog.whereLabel(where))
    }
    expect(webChangelog.whereLabel('both')).toBe('App and map')
    expect(webChangelog.whereLabel('nonsense')).toBe('')
  })

  it('agrees on the migration, which is the one that can only run once', () => {
    const newest = '2026-08-21-c'
    const CASES = [['2026-08-19-a', '1.9.0'], [null, '1.9.0'], [null, null], [null, '']]
    for (const [stored, legacy] of CASES) {
      expect(webChangelog.migratedSeenId(stored, legacy, newest), `${stored}/${legacy}`)
        .toBe(appChangelog.migratedSeenId(stored, legacy, newest))
    }
    // A reader from the old scheme must get the dot; a brand-new one must not.
    // Asserted through the composition, because that is where the two copies
    // could agree on a value that produces the wrong badge.
    const migrated = webChangelog.migratedSeenId(null, '1.9.0', newest)
    expect(webChangelog.hasUnseenEntries(ENTRIES, migrated)).toBe(true)
    expect(webChangelog.unseenEntryCount(ENTRIES, migrated)).toBe(0)
    expect(webChangelog.hasUnseenEntries(ENTRIES, webChangelog.migratedSeenId(null, null, newest))).toBe(false)
  })

  // The two changelog.json copies ship the same entries, for the same reason
  // the modules do: neither deploy path can read a file outside its own
  // directory, so "one shared changelog" is physically two files.
  it('ships the same entries on both surfaces', () => {
    const app = JSON.parse(readFileSync(new URL('../app/changelog.json', import.meta.url), 'utf8'))
    const web = JSON.parse(readFileSync(new URL('./changelog.json', import.meta.url), 'utf8'))
    expect(web).toEqual(app)
    // Newest first, and every entry carries what the panel renders. An entry
    // without an id is the case unseenEntryCount has to guard against, so it
    // must not reach a shipped file.
    expect(app.length).toBeGreaterThan(0)
    for (const e of app) {
      expect(e.id, JSON.stringify(e)).toMatch(/^\d{4}-\d{2}-\d{2}-/)
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(['app', 'map', 'both']).toContain(e.where)
      expect(typeof e.title).toBe('string')
      expect(e.title.length).toBeGreaterThan(0)
      expect(typeof e.body).toBe('string')
      expect(e.body.length).toBeGreaterThan(0)
    }
    const ids = app.map((e) => e.id)
    expect(new Set(ids).size, 'ids must be unique').toBe(ids.length)
    // "Newest first" is a claim about dates, not about slugs. A release lands
    // several notes on one day and the order inside that day is the author's —
    // the one a reader most needs goes on top. Sorting the ids would hand that
    // choice to the alphabet instead. So: each id's prefix must be its own
    // date (which is what makes the next check mean anything), and the dates
    // must not increase down the file.
    for (const e of app) expect(e.id.slice(0, 10), JSON.stringify(e)).toBe(e.date)
    const dates = app.map((e) => e.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })
})

// ---------------------------------------------------------------------------
// Receptions ticker CSS (#322)
// ---------------------------------------------------------------------------
// The ticker is two hand-kept copies (app/src/styles/app.css and web/style.css)
// of the same block, and nothing caught drift between them: the assertions
// above only reach .js modules. The row height now lives in one variable per
// stylesheet with the rest of the geometry derived from it, so these tests pin
// two different things:
//
//   1. the two stylesheets agree — the drift guard #238 left unbuilt for CSS
//   2. the geometry is *derived*, not restated — a literal `height: 260px`
//      would satisfy (1) and still rot the moment the row height changes
//
// and the last one closes the loop the variable exists for: the JS copies read
// the same number the CSS ships.
const APP_CSS = readFileSync(new URL('../app/src/styles/app.css', import.meta.url), 'utf8')
const WEB_CSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const APP_TOKENS = readFileSync(new URL('../app/src/styles/tokens.css', import.meta.url), 'utf8')

// Comments are stripped before any of this parses: these blocks are heavily
// commented, and a comment that names a selector or a property (this file's own
// ".rx-tm is 4ch, not 3" note did exactly that) otherwise satisfies a match and
// returns the neighbouring rule's value.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// The ticker block only — matching over the whole file would let a value from
// an unrelated rule satisfy an assertion.
function tickerBlock(rawCss) {
  const css = stripComments(rawCss)
  const start = css.indexOf('#rx-log')
  expect(start).toBeGreaterThan(-1)
  const end = css.indexOf('.rx-ln.act .rx-tm', start)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end)
}

const decl = (block, selector, prop) => {
  const rule = new RegExp('(^|\\})[^{}]*\\' + selector + '\\b[^{}]*\\{([^}]*)\\}', 'm').exec(block)
  if (!rule) return null
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'm').exec(rule[2])
  return m ? m[1].trim() : null
}

describe('receptions ticker CSS parity (#322)', () => {
  const app = tickerBlock(APP_CSS)
  const web = tickerBlock(WEB_CSS)

  // Both modules read the variable with
  // getComputedStyle(document.documentElement).getPropertyValue(), so a
  // declaration scoped to #rx-log resolves to '' at runtime and the module
  // silently takes its fallback — the layout still looks right, which is what
  // makes it worth a test. The first shipped version of this block had exactly
  // that bug: declared on #rx-log, read from :root, never once succeeding.
  // Split on the closing brace rather than matching rules with a global regex:
  // a pattern anchored on the *previous* rule's '}' consumes that brace, so two
  // adjacent :root rules (which is exactly how style.css declares --ch-bar-h and
  // this one) only ever yield the first.
  const rootDecl = (rawCss) => {
    for (const chunk of stripComments(rawCss).split('}')) {
      const i = chunk.indexOf('{')
      if (i < 0) continue
      const head = chunk.slice(0, i)
      const m = /--ch-rx-line-h:\s*([^;]+);/.exec(chunk.slice(i + 1))
      if (m && /(^|,)\s*(:root|html)\b/.test(head)) return m[1].trim()
    }
    return null
  }

  it('declares the row height where the modules actually read it', () => {
    const appVar = rootDecl(APP_TOKENS)
    const webVar = rootDecl(WEB_CSS)
    expect(appVar, 'tokens.css must declare --ch-rx-line-h on :root').not.toBeNull()
    expect(webVar, 'style.css must declare --ch-rx-line-h on :root').not.toBeNull()
    expect(appVar).toBe(webVar)
    // and it must not also be shadowed by a scoped copy in the ticker block,
    // which is where it started and where the read cannot see it. Matches a
    // declaration only — var(--ch-rx-line-h) references are the point of it.
    const redeclares = (block) => /(^|[;{\s])--ch-rx-line-h\s*:/.test(block)
    expect(redeclares(app), 'app ticker block must not re-declare it').toBe(false)
    expect(redeclares(web), 'web ticker block must not re-declare it').toBe(false)
    // The fallback baked into both modules must be the value the CSS ships,
    // so a stylesheet that fails to load still lays out at the right pitch.
    expect(appTicker.rxLineHeight('')).toBe(appTicker.rxLineHeight(appVar))
    expect(webTicker.rxLineHeight('')).toBe(webTicker.rxLineHeight(webVar))
    expect(appTicker.rxLineHeight(appVar)).toBe(webTicker.rxLineHeight(webVar))
  })

  it('derives the list geometry from the variable rather than restating it', () => {
    for (const [name, block] of [['app', app], ['web', web]]) {
      const height = decl(block, '.rx-list', 'height')
      const padTop = decl(block, '.rx-list', 'scroll-padding-top')
      expect(height, name + ': .rx-list height').toMatch(/calc\(\s*10\s*\*\s*var\(--ch-rx-line-h\)\s*\)/)
      expect(padTop, name + ': .rx-list scroll-padding-top').toMatch(/calc\(\s*6\s*\*\s*var\(--ch-rx-line-h\)\s*\)/)
      // 6 lanes above the playhead and 3 below is what rxFade's divisors
      // encode; the padding is the same geometry expressed in CSS.
      expect(decl(block, '.rx-ln', 'height')).toBe('var(--ch-rx-line-h)')
    }
  })

  it('scales the fixed columns with the type instead of pinning them to pixels', () => {
    // At 12px the shipped 26px/32px held "15m" and "-105" with a few px spare.
    // At 15px they do not, and the RSSI value collides with the sender beside
    // it — so the widths are expressed in characters.
    for (const [name, block] of [['app', app], ['web', web]]) {
      // 4ch, not 3: relTime's hours bucket is unbounded and the widest quick
      // range (Last 30 days) reaches "720h".
      expect(decl(block, '.rx-tm', 'width'), name + ': .rx-tm').toBe('4ch')
      expect(decl(block, '.rx-rs', 'width'), name + ': .rx-rs').toBe('4ch')
      expect(decl(block, '.rx-gt', 'width'), name + ': .rx-gt').toBe('2ch')
    }
  })

  it('keeps the row hit area to its own text so the band passes drags to the map', () => {
    // A full-width row is a full-width click target. content-visibility must
    // stay off the row: with contain-intrinsic-size's zero width, max-content
    // resolves to zero and the row never paints at all.
    for (const [name, block] of [['app', app], ['web', web]]) {
      expect(decl(block, '.rx-ln', 'width'), name + ': .rx-ln width').toBe('max-content')
      expect(decl(block, '.rx-ln', 'content-visibility'), name + ': .rx-ln content-visibility').toBeNull()
      expect(decl(block, '.rx-list', 'pointer-events'), name + ': .rx-list').toBe('none')
    }
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

// nodelayer.js is the third duplicated module, and until #376 it was the one
// with no parity block at all — the file both copies of the node-position layer
// read on every draw. The two are a partial duplicate on purpose: each side has
// functions the other has no use for, and only the shared core is pinned here.
describe('nodelayer — parity of the shared core', () => {
  const SHARED = ['TIGHT_DRIFT_M', 'TRUSTED_ENCIRCLEMENT', 'circleRing', 'drawableNodes',
    'driftPresentation', 'estimateFor', 'groupSenderPoints', 'inBounds', 'isRegistryIdKind', 'nodesInView']

  it('keeps the shared core present on both sides, and the divergence deliberate', () => {
    const names = (m) => Object.keys(m).sort()
    for (const n of SHARED) {
      expect(webLayer[n], `web is missing ${n}`).toBeDefined()
      expect(appLayer[n], `app is missing ${n}`).toBeDefined()
    }
    // Named, so growing a copy is a decision and not an accident: a new export
    // on one side lands here or in SHARED, and either way this test says so.
    expect(names(appLayer).filter((n) => !SHARED.includes(n)))
      .toEqual(['groupSenderPointsForNodes', 'senderIdMatches'])
    expect(names(webLayer).filter((n) => !SHARED.includes(n))).toEqual(['nodeRows'])
  })

  it('agrees on the drift threshold, at the boundary', () => {
    // ~99 m and ~101 m north of the estimate: one each side of TIGHT_DRIFT_M,
    // so a copy whose threshold moved by 2 m fails here. A 500 m fixture would
    // pass whatever the threshold became.
    const est = { centroid: { lat: 51, lon: 4 }, stats: { encirclement: 0.75, searchRadiusM: 300 } }
    for (const m of [99, 101]) {
      const advertised = { lat: 51 + m * M, lon: 4 }
      expect(webLayer.driftPresentation({ advertised, estimate: est }))
        .toEqual(appLayer.driftPresentation({ advertised, estimate: est }))
    }
    expect(webLayer.driftPresentation({ advertised: { lat: 51 + 99 * M, lon: 4 }, estimate: est }).kind).toBe('tight')
    expect(webLayer.driftPresentation({ advertised: { lat: 51 + 101 * M, lon: 4 }, estimate: est }).kind).toBe('drifted')
    expect(webLayer.TIGHT_DRIFT_M).toBe(appLayer.TIGHT_DRIFT_M)
  })

  it('agrees on when the geometry may be trusted, at the boundary', () => {
    // 0.5 is the gate: at it the search radius is claimed, a hair under it the
    // presentation falls back to an untrusted drift circle.
    const advertised = { lat: 51 + 400 * M, lon: 4 }
    const withEnc = (encirclement, searchRadiusM = 300) =>
      ({ centroid: { lat: 51, lon: 4 }, stats: { encirclement, searchRadiusM } })
    for (const e of [0.49, 0.5]) {
      expect(webLayer.driftPresentation({ advertised, estimate: withEnc(e) }))
        .toEqual(appLayer.driftPresentation({ advertised, estimate: withEnc(e) }))
    }
    expect(webLayer.driftPresentation({ advertised, estimate: withEnc(0.5) }).kind).toBe('drifted')
    expect(webLayer.driftPresentation({ advertised, estimate: withEnc(0.49) }).kind).toBe('unverified')
    // A searchRadiusM that is not a number must not be trusted either, however
    // well encircled — otherwise a circle gets drawn from a NaN radius.
    expect(webLayer.driftPresentation({ advertised, estimate: withEnc(1, null) }).kind).toBe('unverified')
    expect(webLayer.TRUSTED_ENCIRCLEMENT).toBe(appLayer.TRUSTED_ENCIRCLEMENT)
  })

  it('agrees on the three degenerate presentations', () => {
    const estimate = { centroid: { lat: 51, lon: 4 }, stats: { encirclement: 1, searchRadiusM: 100 } }
    const advertised = { lat: 51, lon: 4 }
    for (const args of [{}, { advertised }, { estimate },
      { advertised: { lat: 51, lon: null }, estimate: null }]) {
      expect(webLayer.driftPresentation(args)).toEqual(appLayer.driftPresentation(args))
    }
    expect(webLayer.driftPresentation({}).kind).toBe('none')
    expect(webLayer.driftPresentation({ advertised }).kind).toBe('advertised-only')
    expect(webLayer.driftPresentation({ estimate }).kind).toBe('estimate-only')
  })

  it('agrees on which registry rows can be drawn, and which ids may name one', () => {
    const rows = [
      { pubkey: 'aa', lat: 51, lon: 4 },
      { pubkey: 'bb', lat: 51 },                 // half a position
      { pubkey: 'cc', lat: '51', lon: '4' },     // strings are not coordinates
      { lat: 51, lon: 4 },                       // nothing to attribute it to
      { pubkey: 'dd', lat: NaN, lon: 4 },
      null,
    ]
    expect(webLayer.drawableNodes(rows)).toEqual(appLayer.drawableNodes(rows))
    expect(webLayer.drawableNodes(rows)).toHaveLength(1)
    expect(webLayer.drawableNodes('nope')).toEqual(appLayer.drawableNodes('nope'))
    for (const kind of ['advert_pubkey', 'discover_pubkey', 'relay', 'direct_hash', 'channel_name', undefined]) {
      expect(webLayer.isRegistryIdKind(kind), kind).toBe(appLayer.isRegistryIdKind(kind))
    }
    expect(webLayer.isRegistryIdKind('advert_pubkey')).toBe(true)
    expect(webLayer.isRegistryIdKind('relay')).toBe(false)
  })

  it('agrees on the viewport test, edges included', () => {
    const bounds = { minLat: 50, minLon: 3, maxLat: 52, maxLon: 5 }
    const pts = [
      { lat: 50, lon: 3 }, { lat: 52, lon: 5 },          // exactly on both corners
      { lat: 49.999, lon: 4 }, { lat: 51, lon: 5.001 },  // a hair outside each
      { lat: 51, lon: 4 }, { lat: null, lon: 4 },
    ]
    for (const p of pts) expect(webLayer.inBounds(p, bounds), JSON.stringify(p)).toBe(appLayer.inBounds(p, bounds))
    expect(webLayer.inBounds({ lat: 50, lon: 3 }, bounds)).toBe(true)   // inclusive, not exclusive
    expect(webLayer.nodesInView(pts, bounds)).toEqual(appLayer.nodesInView(pts, bounds))
    expect(webLayer.nodesInView(pts, bounds)).toHaveLength(3)
    expect(webLayer.nodesInView(pts, null)).toEqual(appLayer.nodesInView(pts, null))
  })

  it('buckets receptions by sender identically, case folded, unlocated dropped', () => {
    const recs = [
      { sender_id: 'AA', lat: 51, lon: 4, rssi: -70 },
      { sender_id: 'aa', lat: 51.001, lon: 4, rssi: -80 },   // same node, other case
      { sender_id: 'bb', lat: 51, lon: 4, rssi: -60 },
      { sender_id: 'cc', lat: null, lon: 4, rssi: -60 },     // no fix: no information
      { lat: 51, lon: 4, rssi: -60 },
    ]
    const webOut = webLayer.groupSenderPoints(recs)
    expect([...webOut]).toEqual([...appLayer.groupSenderPoints(recs)])
    expect(webOut.get('aa')).toHaveLength(2)
    expect(webOut.has('cc')).toBe(false)
  })

  it('estimates identically, including the too-few-inliers floor', () => {
    // Two points is below the 3-inlier floor; the third crosses it. A fixture
    // with only a big cluster would pass whatever the floor became.
    const ring = [
      { lat: 51, lon: 4, rssi: -60 },
      { lat: 51 + 300 * M, lon: 4, rssi: -70 },
      { lat: 51, lon: 4 + 300 * M, rssi: -80 },
      { lat: 51 - 300 * M, lon: 4, rssi: -90 },
    ]
    expect(webLayer.estimateFor(ring.slice(0, 2))).toEqual(appLayer.estimateFor(ring.slice(0, 2)))
    expect(webLayer.estimateFor(ring.slice(0, 2))).toBeNull()
    expect(webLayer.estimateFor(ring)).toEqual(appLayer.estimateFor(ring))
    expect(webLayer.estimateFor(ring).n).toBe(4)
    expect(webLayer.estimateFor([])).toEqual(appLayer.estimateFor([]))
  })

  it('draws the same circle ring, and refuses the same degenerate ones', () => {
    const centre = { lat: 51, lon: 4 }
    expect(webLayer.circleRing(centre, 500)).toEqual(appLayer.circleRing(centre, 500))
    expect(webLayer.circleRing(centre, 500)).toHaveLength(49)          // 48 steps, closed
    expect(webLayer.circleRing(centre, 500, 6)).toEqual(appLayer.circleRing(centre, 500, 6))
    for (const bad of [0, -1, null]) {
      expect(webLayer.circleRing(centre, bad)).toEqual(appLayer.circleRing(centre, bad))
      expect(webLayer.circleRing(centre, bad)).toEqual([])
    }
    expect(webLayer.circleRing(null, 500)).toEqual(appLayer.circleRing(null, 500))
  })
})

// nodeposnotice.js is a partial port (#376): web needs states the app cannot
// have — an unconfigured server, a role the server refuses — so only the lines
// both surfaces show are shared. Those two are what AGENTS.md §7 requires on
// screen, which is exactly why they must not drift apart.
describe('nodeposnotice — parity of the two shared lines', () => {
  it('shows the same key and the same empty-registry line', () => {
    expect(webNotice.NODEPOS_KEY_TEXT).toBe(appNotice.NODEPOS_KEY_TEXT)
    expect(webNotice.NODEPOS_EMPTY_TEXT).toBe(appNotice.NODEPOS_EMPTY_TEXT)
    // §7's requirement is the glyph meaning, so pin the content too: a key that
    // lost its ▲/● would still be "identical on both sides".
    expect(webNotice.NODEPOS_KEY_TEXT).toMatch(/▲.*●/)
  })

  it('chooses between them the same way', () => {
    for (const args of [undefined, {}, { registryEmpty: false }, { registryEmpty: true }]) {
      expect(webNotice.nodePosKeyText(args)).toBe(appNotice.nodePosKeyText(args))
    }
    expect(webNotice.nodePosKeyText({ registryEmpty: true })).toBe(webNotice.NODEPOS_EMPTY_TEXT)
  })

  it('keeps web a strict superset — the app has no server to be unconfigured', () => {
    for (const n of ['NODEPOS_KEY_TEXT', 'NODEPOS_EMPTY_TEXT', 'nodePosKeyText']) {
      expect(appNotice[n], n).toBeDefined()
      expect(webNotice[n], n).toBeDefined()
    }
    expect(Object.keys(webNotice).filter((n) => !(n in appNotice)).sort())
      .toEqual(['NODEPOS_GUEST_TEXT', 'NODEPOS_NONE_IN_VIEW_TEXT', 'NODEPOS_STALE_SUFFIX',
        'NODEPOS_UNAVAILABLE_TEXT', 'NODEPOS_UNCONFIGURED_TEXT', 'nodePosPresentation', 'registryStatusFor'])
  })
})

// initialSettingsTab is the fifth duplicated decision (#421 gave the app a
// What's new tab, #420 gives web the same sheet). Only this function is
// copied, not the module around it: the app's settings.js also loads the
// attenuator, the sound mode and the view index, none of which web has. So
// parity is asserted on the behaviour that must agree rather than on an
// export set, and the cases are the two branches plus the shapes a caller can
// actually pass — a missing flag is what a first visit hands it.
describe('initialSettingsTab — parity between the app and web copies', () => {
  // The shared decision is "unread notes win once"; the read fallback is each
  // surface's own first tab (#539 gave the app a Status tab, web opens on
  // Settings), so only the notes branch is compared cross-copy.
  it('sends an unread reader to the notes, on both surfaces', () => {
    expect(webInitialTab({ unseenChangelog: true })).toBe('whatsnew')
    expect(appInitialTab({ unseenChangelog: true })).toBe('whatsnew')
  })

  it('falls back to its surface-first tab once the notes are read', () => {
    for (const input of [{ unseenChangelog: false }, {}, undefined]) {
      expect(webInitialTab(input)).toBe('settings')
      expect(appInitialTab(input)).toBe('status')
    }
  })
})

// timewindows.js is a byte-identical copy (#557), not an equivalent one: the
// map's quick ranges and the app's "Plot last" select are both built from it,
// and the issue was filed because the two lists had drifted apart in length
// and in wording. A byte comparison also catches what a behaviour test cannot:
// a comment on one side explaining a rule the other side no longer follows.
describe('the time windows are one file on both surfaces (#557)', () => {
  it('timewindows.js is identical in app/src', () => {
    const web = readFileSync(new URL('./timewindows.js', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../app/src/timewindows.js', import.meta.url), 'utf8')
    expect(app, 'app/src/timewindows.js has drifted from web/timewindows.js').toBe(web)
  })
})
