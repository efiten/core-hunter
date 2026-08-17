import { describe, it, expect } from 'vitest'
import { inBounds, nodesInView, driftPresentation, groupSenderPoints, estimateFor, circleRing, TIGHT_DRIFT_M, TRUSTED_ENCIRCLEMENT, isRegistryIdKind, drawableNodes, nodeRows } from './nodelayer.js'
import { haversineM } from './locate.js'

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

  // Load-bearing beyond this file (#272): map.js skips 'estimate-only', and
  // gates cachedPosition on isFullPubkey, so an id that is not a full pubkey
  // gets advertised = null and never reaches the drawn set. That is what makes
  // every drawn entry a distinct node, and why no coordinate dedupe is needed
  // — or wanted, since it would hide two repeaters sharing one mast.
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

describe('isRegistryIdKind — which ids live in the pubkey namespace (#296)', () => {
  it('accepts the two kinds that carry a pubkey', () => {
    expect(isRegistryIdKind('advert_pubkey')).toBe(true)
    expect(isRegistryIdKind('discover_pubkey')).toBe(true)
  })
  it('rejects the kinds that are a different namespace entirely', () => {
    // A relay path element or a channel name can be 64 hex by coincidence;
    // without this gate it would be looked up as a node pubkey.
    expect(isRegistryIdKind('relay')).toBe(false)
    expect(isRegistryIdKind('direct_hash')).toBe(false)
    expect(isRegistryIdKind('channel_name')).toBe(false)
    expect(isRegistryIdKind(undefined)).toBe(false)
  })
})

describe('drawableNodes', () => {
  it('keeps only rows with a pubkey and a finite position', () => {
    const rows = drawableNodes([
      { pubkey: 'aa', lat: 51, lon: 4 },
      { pubkey: 'bb', lat: null, lon: 4 },     // resolver knows it, has no position
      { pubkey: '', lat: 51, lon: 4 },          // no identity to attribute it to
      { pubkey: 'cc', lat: NaN, lon: 4 },
      null,
    ])
    expect(rows.map((r) => r.pubkey)).toEqual(['aa'])
  })
  it('is empty for a non-array', () => {
    expect(drawableNodes(undefined)).toEqual([])
  })
})

describe('nodeRows — registry slice paired with our own receptions (#377)', () => {
  const NODES = [
    { pubkey: 'AA'.repeat(32), name: 'Repeater-Zuid', lat: 51.0, lon: 4.0 },
    { pubkey: 'bb'.repeat(32), name: 'Never-heard', lat: 51.5, lon: 4.5 },
  ]
  // Receptions around the first node only, keyed as groupSenderPoints keys them.
  const heard = new Map([[ 'aa'.repeat(32), [
    { lat: 51.0005, lon: 4.0, rssi: -70 },
    { lat: 50.9995, lon: 4.0, rssi: -72 },
    { lat: 51.0, lon: 4.0007, rssi: -75 },
    { lat: 51.0, lon: 3.9993, rssi: -78 },
  ]]])

  it('draws every registry node in the slice, heard or not', () => {
    // The whole point of #377: a node nobody in this filter heard still gets
    // its advertised position drawn. Before, the layer could only ever show
    // nodes present in the filtered reception set.
    const rows = nodeRows(NODES, heard)
    expect(rows.map((r) => r.name)).toEqual(['Repeater-Zuid', 'Never-heard'])
    expect(rows.every((r) => r.advertised.lat != null)).toBe(true)
  })

  it('pairs an estimate only where we have receptions for that node', () => {
    const rows = nodeRows(NODES, heard)
    expect(rows[0].est).not.toBeNull()
    expect(rows[1].est).toBeNull()
    expect(rows[1].p.kind).toBe('advertised-only')
  })

  it('lower-cases the registry pubkey, since reception ids arrive lower-cased', () => {
    // NODES[0] is upper-case on purpose: a case mismatch would silently make
    // every node look unheard, which is the same empty layer #377 is fixing.
    expect(nodeRows(NODES, heard)[0].id).toBe('aa'.repeat(32))
    expect(nodeRows(NODES, heard)[0].est).not.toBeNull()
  })

  it('draws the advertised position with no receptions at all', () => {
    const rows = nodeRows(NODES, new Map())
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.p.kind === 'advertised-only')).toBe(true)
  })

  it('skips registry rows that cannot be plotted', () => {
    expect(nodeRows([{ pubkey: 'aa', lat: null, lon: 4 }], new Map())).toEqual([])
  })
})
