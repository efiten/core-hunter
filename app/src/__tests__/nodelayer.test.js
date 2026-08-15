import { describe, it, expect } from 'vitest'
import { inBounds, nodesInView, driftPresentation, groupSenderPoints, senderIdMatches, groupSenderPointsForNodes, estimateFor, circleRing, TIGHT_DRIFT_M, TRUSTED_ENCIRCLEMENT, drawableNodes } from '../nodelayer.js'
import { haversineM } from '../locate.js'

const node = (o) => ({ pubkey: 'aa'.repeat(32), name: 'Node', lat: 51.2, lon: 4.4, ...o })
// A bounds box around Antwerp-ish coordinates.
const BOUNDS = { minLat: 51.0, maxLat: 51.4, minLon: 4.2, maxLon: 4.6 }

describe('inBounds', () => {
  it('accepts a node inside the box', () => {
    expect(inBounds({ lat: 51.2, lon: 4.4 }, BOUNDS)).toBe(true)
  })
  it('accepts a node exactly on an edge', () => {
    expect(inBounds({ lat: 51.0, lon: 4.2 }, BOUNDS)).toBe(true)
    expect(inBounds({ lat: 51.4, lon: 4.6 }, BOUNDS)).toBe(true)
  })
  it('rejects a node outside in either axis', () => {
    expect(inBounds({ lat: 51.5, lon: 4.4 }, BOUNDS)).toBe(false)
    expect(inBounds({ lat: 51.2, lon: 4.7 }, BOUNDS)).toBe(false)
  })
  it('rejects a node with a missing or non-numeric coordinate', () => {
    expect(inBounds({ lat: 51.2, lon: null }, BOUNDS)).toBe(false)
    expect(inBounds({ lat: undefined, lon: 4.4 }, BOUNDS)).toBe(false)
  })
})

describe('nodesInView', () => {
  it('keeps only positioned nodes within the bounds', () => {
    const out = nodesInView([
      node({ pubkey: 'in', lat: 51.2, lon: 4.4 }),
      node({ pubkey: 'out', lat: 52.9, lon: 4.4 }),
      node({ pubkey: 'nopos', lat: null, lon: null }),
    ], BOUNDS)
    expect(out.map((n) => n.pubkey)).toEqual(['in'])
  })
  it('returns an empty array for missing input rather than throwing', () => {
    expect(nodesInView(null, BOUNDS)).toEqual([])
    expect(nodesInView([node()], null)).toEqual([])
  })
})

describe('driftPresentation — how a node with both positions is drawn (#197)', () => {
  const advertised = { lat: 51.2, lon: 4.4 }

  it('is advertised-only when there is no estimate', () => {
    expect(driftPresentation({ advertised, estimate: null })).toEqual({ kind: 'advertised-only' })
  })

  it('is estimate-only when the node never advertised a position', () => {
    const estimate = { centroid: { lat: 51.2, lon: 4.4 }, stats: { searchRadiusM: 100, encirclement: 1 } }
    expect(driftPresentation({ advertised: null, estimate })).toEqual({ kind: 'estimate-only' })
  })

  it('is tight (green, no circle) when drift is at or under 100 m', () => {
    // ~66 m north of the advertised point.
    const estimate = { centroid: { lat: 51.2006, lon: 4.4 }, stats: { searchRadiusM: 300, encirclement: 1 } }
    const out = driftPresentation({ advertised, estimate })
    expect(out.kind).toBe('tight')
    expect(out.circle).toBeNull()
    expect(out.driftM).toBeGreaterThan(0)
    expect(out.driftM).toBeLessThanOrEqual(TIGHT_DRIFT_M)
  })

  it('draws the search radius when drift exceeds 100 m and the geometry is trusted', () => {
    // ~1.1 km north — well past the tight threshold.
    const estimate = { centroid: { lat: 51.21, lon: 4.4 }, stats: { searchRadiusM: 400, encirclement: 0.75 } }
    const out = driftPresentation({ advertised, estimate })
    expect(out.kind).toBe('drifted')
    expect(out.circle).toEqual({ kind: 'search', radiusM: 400 })
    expect(out.outsideCircle).toBe(true) // 1.1 km drift > 400 m radius
  })

  it('reports the advertised pin as inside when drift is within the trusted search radius', () => {
    const estimate = { centroid: { lat: 51.2018, lon: 4.4 }, stats: { searchRadiusM: 600, encirclement: 0.75 } }
    const out = driftPresentation({ advertised, estimate })
    expect(out.kind).toBe('drifted')
    expect(out.circle.kind).toBe('search')
    expect(out.outsideCircle).toBe(false) // ~200 m drift < 600 m radius
  })

  it('falls back to a drift circle when the estimate is one-sided', () => {
    const estimate = { centroid: { lat: 51.21, lon: 4.4 }, stats: { searchRadiusM: 400, encirclement: 0.25 } }
    const out = driftPresentation({ advertised, estimate })
    expect(out.kind).toBe('unverified')
    expect(out.circle.kind).toBe('drift')
    expect(out.circle.radiusM).toBeCloseTo(out.driftM, 5)
    expect(out.outsideCircle).toBe(false) // no accuracy claim is made
  })

  it('treats exactly the encirclement threshold as trusted', () => {
    const estimate = { centroid: { lat: 51.21, lon: 4.4 }, stats: { searchRadiusM: 400, encirclement: TRUSTED_ENCIRCLEMENT } }
    expect(driftPresentation({ advertised, estimate }).circle.kind).toBe('search')
  })

  it('falls back to a drift circle when the trusted estimate has no search radius', () => {
    const estimate = { centroid: { lat: 51.21, lon: 4.4 }, stats: { searchRadiusM: null, encirclement: 1 } }
    expect(driftPresentation({ advertised, estimate }).circle.kind).toBe('drift')
  })

  it('is advertised-only when the estimate exists but produced no centroid', () => {
    const estimate = { centroid: null, stats: { searchRadiusM: null, encirclement: 0 } }
    expect(driftPresentation({ advertised, estimate })).toEqual({ kind: 'advertised-only' })
  })

  it('reports nothing to draw when neither position exists', () => {
    expect(driftPresentation({ advertised: null, estimate: null })).toEqual({ kind: 'none' })
  })
})

describe('senderIdMatches (#272 blocker 1)', () => {
  const fullPubkey = 'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'

  it('matches advert_pubkey exactly (full 64-hex)', () => {
    expect(senderIdMatches(fullPubkey, 'advert_pubkey', fullPubkey)).toBe(true)
    expect(senderIdMatches('aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011', 'advert_pubkey', fullPubkey)).toBe(true)
  })
  it('rejects advert_pubkey with wrong full key', () => {
    expect(senderIdMatches('1111111111111111111111111111111111111111111111111111111111111111', 'advert_pubkey', fullPubkey)).toBe(false)
  })
  it('matches discover_pubkey as a prefix (>= 2 bytes / 4 hex)', () => {
    expect(senderIdMatches('aabbccdd', 'discover_pubkey', fullPubkey)).toBe(true)
    expect(senderIdMatches('aabb', 'discover_pubkey', fullPubkey)).toBe(true)
  })
  it('rejects discover_pubkey prefix shorter than 4 hex (< 2 bytes)', () => {
    expect(senderIdMatches('aa', 'discover_pubkey', fullPubkey)).toBe(false)
  })
  it('rejects discover_pubkey that does not match the key prefix', () => {
    expect(senderIdMatches('bbccddee', 'discover_pubkey', fullPubkey)).toBe(false)
  })
  it('ignores relay (path prefix) — never matches registry nodes', () => {
    expect(senderIdMatches('aabbccdd', 'relay', fullPubkey)).toBe(false)
    expect(senderIdMatches('aabb', 'relay', fullPubkey)).toBe(false)
  })
  it('ignores direct_hash — never matches registry nodes', () => {
    expect(senderIdMatches('abcd', 'direct_hash', fullPubkey)).toBe(false)
  })
  it('ignores channel_name — never matches registry nodes', () => {
    expect(senderIdMatches('some-channel', 'channel_name', fullPubkey)).toBe(false)
  })
  it('handles case-insensitive matching', () => {
    expect(senderIdMatches('AABBCCDD', 'discover_pubkey', fullPubkey)).toBe(true)
    expect(senderIdMatches(fullPubkey.toUpperCase(), 'advert_pubkey', fullPubkey)).toBe(true)
  })
})

describe('groupSenderPointsForNodes', () => {
  const A = 'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'
  const B = 'aabbffff1122334455667788990011aabbccddeeff0011aabbccddeeff002233'
  const C = 'ffee00112233445566778899aabbccddeeff00112233445566778899aabbccdd'
  const rec = (o) => ({ sender_id: A, sender_kind: 'advert_pubkey', lat: 51.2, lon: 4.4, rssi: -70, ...o })
  const nodes = (...keys) => keys.map((k) => ({ pubkey: k, lat: 51, lon: 4 }))

  it('attributes an exact advert pubkey to its node', () => {
    const out = groupSenderPointsForNodes([rec({ sender_id: A }), rec({ sender_id: C })], nodes(A))
    expect(out.get(A)).toHaveLength(1)
    expect(out.get(A)[0].rssi).toBe(-70)
  })

  it('attributes a discover prefix to the one node it matches', () => {
    const recs = [
      rec({ sender_id: 'aabbccdd', sender_kind: 'discover_pubkey' }),
      rec({ sender_id: 'ffee0011', sender_kind: 'discover_pubkey' }),
    ]
    const out = groupSenderPointsForNodes(recs, nodes(A, C))
    expect(out.get(A)).toHaveLength(1)
    expect(out.get(C)).toHaveLength(1)
  })

  // The reason this function takes the whole node set instead of one node.
  it('refuses a prefix that matches two nodes, rather than giving it to both', () => {
    // 'aabb' starts both A and B. There is no way to tell which one sent it,
    // so it must contribute to neither (#295).
    const recs = [rec({ sender_id: 'aabb', sender_kind: 'discover_pubkey' })]
    const out = groupSenderPointsForNodes(recs, nodes(A, B))
    expect(out.get(A)).toHaveLength(0)
    expect(out.get(B)).toHaveLength(0)
  })

  it('still attributes the unambiguous prefixes in the same batch', () => {
    const recs = [
      rec({ sender_id: 'aabb', sender_kind: 'discover_pubkey' }),       // ambiguous A/B
      rec({ sender_id: 'aabbccdd', sender_kind: 'discover_pubkey' }),   // A only
      rec({ sender_id: 'ffee0011', sender_kind: 'discover_pubkey' }),   // C only
    ]
    const out = groupSenderPointsForNodes(recs, nodes(A, B, C))
    expect(out.get(A)).toHaveLength(1)
    expect(out.get(B)).toHaveLength(0)
    expect(out.get(C)).toHaveLength(1)
  })

  it('is not fooled by an exact advert that also prefixes another node', () => {
    // An advert carries the whole key, so it is never ambiguous even when a
    // shorter node key happens to be a prefix relationship away.
    const out = groupSenderPointsForNodes([rec({ sender_id: A })], nodes(A, B))
    expect(out.get(A)).toHaveLength(1)
    expect(out.get(B)).toHaveLength(0)
  })

  it('ignores relay, direct_hash and channel_name kinds entirely', () => {
    const recs = [
      rec({ sender_id: 'aabbccdd', sender_kind: 'relay' }),
      rec({ sender_id: 'aa', sender_kind: 'direct_hash' }),
      rec({ sender_id: 'Repeater-Zuid', sender_kind: 'channel_name' }),
    ]
    const out = groupSenderPointsForNodes(recs, nodes(A))
    expect(out.get(A)).toHaveLength(0)
  })

  it('rejects a discover prefix shorter than 2 bytes', () => {
    const out = groupSenderPointsForNodes([rec({ sender_id: 'aa', sender_kind: 'discover_pubkey' })], nodes(A))
    expect(out.get(A)).toHaveLength(0)
  })

  it('drops receptions without a GPS fix', () => {
    const recs = [rec({ lat: null }), rec({ lon: undefined }), rec({})]
    const out = groupSenderPointsForNodes(recs, nodes(A))
    expect(out.get(A)).toHaveLength(1)
  })

  it('returns an entry for every node, even one that heard nothing', () => {
    const out = groupSenderPointsForNodes([], nodes(A, C))
    expect(out.get(A)).toEqual([])
    expect(out.get(C)).toEqual([])
  })

  it('is case-insensitive on both sides', () => {
    const out = groupSenderPointsForNodes([rec({ sender_id: A.toUpperCase() })], nodes(A.toUpperCase()))
    expect(out.get(A)).toHaveLength(1)
  })
})

describe('groupSenderPoints', () => {
  const rec = (o) => ({ sender_id: 'aa', lat: 51.2, lon: 4.4, rssi: -70, ...o })

  it('groups located receptions by lowercased sender id', () => {
    const g = groupSenderPoints([
      rec({ sender_id: 'AA', rssi: -60 }),
      rec({ sender_id: 'aa', rssi: -70 }),
      rec({ sender_id: 'bb' }),
    ])
    expect(g.get('aa')).toHaveLength(2)
    expect(g.get('bb')).toHaveLength(1)
  })
  it('drops receptions without a sender or without a GPS fix', () => {
    const g = groupSenderPoints([
      rec({ sender_id: null }),
      rec({ sender_id: 'cc', lat: null }),
      rec({ sender_id: 'dd' }),
    ])
    expect([...g.keys()]).toEqual(['dd'])
  })
  it('returns an empty map for missing input', () => {
    expect(groupSenderPoints(null).size).toBe(0)
  })
})

describe('estimateFor', () => {
  // A small spread of points around a centre, enough to survive the <3 rule.
  const spread = [
    { lat: 51.200, lon: 4.400, rssi: -60 },
    { lat: 51.202, lon: 4.402, rssi: -70 },
    { lat: 51.198, lon: 4.398, rssi: -80 },
    { lat: 51.201, lon: 4.397, rssi: -75 },
  ]

  it('returns a centroid and geometry stats', () => {
    const est = estimateFor(spread)
    expect(est.centroid.lat).toBeCloseTo(51.2, 1)
    expect(est.stats.searchRadiusM).toBeGreaterThan(0)
    expect(est.stats.encirclement).toBeGreaterThan(0)
    expect(est.n).toBeGreaterThanOrEqual(3)
  })
  it('returns null below 3 inliers, matching locate()', () => {
    expect(estimateFor(spread.slice(0, 2))).toBeNull()
    expect(estimateFor([])).toBeNull()
  })
})

describe('circleRing', () => {
  it('produces a closed ring of lon/lat pairs', () => {
    const ring = circleRing({ lat: 51.2, lon: 4.4 }, 500, 8)
    expect(ring).toHaveLength(9)               // steps + repeated first point
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })
  it('places every vertex at approximately the requested radius', () => {
    const centre = { lat: 51.2, lon: 4.4 }
    for (const [lon, lat] of circleRing(centre, 500, 12)) {
      expect(haversineM(centre, { lat, lon })).toBeCloseTo(500, -1)
    }
  })
  it('returns an empty ring for a non-positive radius', () => {
    expect(circleRing({ lat: 51.2, lon: 4.4 }, 0, 8)).toEqual([])
  })
})

// #307 review: the empty-state line is driven by how many registry nodes can
// actually be drawn, not how many rows came back. The resolve proxy strips
// lat/lon below the member role, so a full response of position-less nodes is
// exactly the "nothing will be drawn" case the notice exists for.
describe('drawableNodes — registry rows that can actually be plotted', () => {
  const node = (o) => ({ pubkey: 'aa', lat: 51, lon: 4, ...o })

  it('keeps a node with a pubkey and finite coordinates', () => {
    expect(drawableNodes([node()])).toHaveLength(1)
  })
  it('drops a node whose position was stripped or never set', () => {
    expect(drawableNodes([node({ lat: null }), node({ lon: undefined }), node({ lat: 'x' })])).toEqual([])
  })
  it('drops a node with no pubkey to attribute it to', () => {
    expect(drawableNodes([node({ pubkey: '' }), node({ pubkey: null })])).toEqual([])
  })
  it('drops NaN and Infinity, which pass a null check but not a map', () => {
    expect(drawableNodes([node({ lat: NaN }), node({ lon: Infinity })])).toEqual([])
  })
  it('is total for junk input', () => {
    expect(drawableNodes(null)).toEqual([])
    expect(drawableNodes([null, undefined, 5, 'x'])).toEqual([])
  })
  it('agrees with inBounds: everything it keeps can be tested against a viewport', () => {
    const world = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
    for (const n of drawableNodes([node(), node({ lat: -33.9, lon: 18.4 })])) {
      expect(inBounds(n, world)).toBe(true)
    }
  })
})
