import { describe, it, expect } from 'vitest'
import { inBounds, nodesInView, driftPresentation, TIGHT_DRIFT_M, TRUSTED_ENCIRCLEMENT } from '../nodelayer.js'

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
