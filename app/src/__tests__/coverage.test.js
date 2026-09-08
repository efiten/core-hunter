import { describe, it, expect } from 'vitest'
import {
  isRepeaterHearing, isTwoWay, hueSlot, assignHues, HUE_COUNT, NEAR_M,
  rayStrength, rayStyle, ONE_WAY_OPACITY, DIM_OPACITY,
  starOrigin, coverageStars, coverageFeatures, RAY_ALT_M,
} from '../coverage.js'

const A = 'aa'.repeat(32), B = 'bb'.repeat(32)

// #603: which hearings a repeater's star is built from. The same rule as the
// feed's repeater test, plus the Discover reply, which is a reply from the
// node itself. A companion advert is not a repeater's hearing.
describe('isRepeaterHearing', () => {
  it('takes a Repeater role, a relay, a Discover reply and a trace reply', () => {
    expect(isRepeaterHearing({ sender_kind: 'advert_pubkey', sender_role: 'Repeater' })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'relay', sender_role: null })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'discover_pubkey', sender_role: null })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'trace_reply' })).toBe(true)
  })
  it('leaves a companion advert, a channel name and a path hash out', () => {
    expect(isRepeaterHearing({ sender_kind: 'advert_pubkey', sender_role: 'Companion' })).toBe(false)
    expect(isRepeaterHearing({ sender_kind: 'channel_name' })).toBe(false)
    expect(isRepeaterHearing({ sender_kind: 'path_hash' })).toBe(false)
    expect(isRepeaterHearing(null)).toBe(false)
  })
})

// A hearing where the repeater also heard us: a Discover or trace reply to
// our own ask. Overhearing a relay is one way.
describe('isTwoWay', () => {
  it('is the Discover reply and the trace reply, nothing else', () => {
    expect(isTwoWay({ sender_kind: 'discover_pubkey' })).toBe(true)
    expect(isTwoWay({ sender_kind: 'trace_reply' })).toBe(true)
    expect(isTwoWay({ sender_kind: 'relay' })).toBe(false)
    expect(isTwoWay({ sender_kind: 'advert_pubkey', sender_role: 'Repeater' })).toBe(false)
  })
})

// The hue is derived from the id, so a repeater keeps its colour across
// sessions and between the app and the map. Case must not change it: the
// same pubkey arrives upper-cased from some resolvers.
describe('hueSlot', () => {
  it('is stable, case-insensitive and inside the palette', () => {
    expect(hueSlot(A)).toBe(hueSlot(A))
    expect(hueSlot(A)).toBe(hueSlot(A.toUpperCase()))
    for (const id of [A, B, '3f', 'ab12', '']) {
      const s = hueSlot(id)
      expect(Number.isInteger(s) && s >= 0 && s < HUE_COUNT).toBe(true)
    }
  })
  it('spreads different ids over different slots', () => {
    // Pseudo-random pubkeys from a fixed seed, so the fixture is real-shaped
    // and the run is repeatable.
    let seed = 7
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 16 }
    const ids = Array.from({ length: 40 }, () => Array.from({ length: 64 }, () => (rnd() % 16).toString(16)).join(''))
    expect(new Set(ids.map(hueSlot)).size).toBeGreaterThan(HUE_COUNT / 2)
  })
})

// Two repeaters near each other should not share a hue (#603): the base slot
// is the hash, and a neighbour within NEAR_M that already holds it pushes the
// later id (in id order) to the next free slot. A far-away twin keeps the hash.
describe('assignHues', () => {
  // Two ids that hash to the same slot, found by search so the test does not
  // depend on the hash function's internals.
  function collidingPair() {
    const seen = new Map()
    for (let i = 0; i < 10000; i++) {
      const id = i.toString(16).padStart(4, '0').repeat(16)
      const s = hueSlot(id)
      if (seen.has(s)) return [seen.get(s), id].sort()
      seen.set(s, id)
    }
    throw new Error('no collision in 10000 ids')
  }
  it('gives the first id its hash slot and moves a colliding neighbour off it', () => {
    const [x, y] = collidingPair()
    const hues = assignHues([{ id: x, lat: 51, lon: 4 }, { id: y, lat: 51.001, lon: 4 }])
    expect(hues.get(x)).toBe(hueSlot(x))
    expect(hues.get(y)).not.toBe(hueSlot(y))
    expect(hues.get(y)).toBe((hueSlot(y) + 1) % HUE_COUNT)
  })
  it('lets two far-apart ids share a slot', () => {
    const [x, y] = collidingPair()
    const hues = assignHues([{ id: x, lat: 51, lon: 4 }, { id: y, lat: 52, lon: 5 }])
    expect(hues.get(x)).toBe(hueSlot(x))
    expect(hues.get(y)).toBe(hueSlot(y))
  })
  it('is by distance, not by index: the boundary is NEAR_M', () => {
    const [x, y] = collidingPair()
    const dLat = (NEAR_M - 10) / 111320
    const near = assignHues([{ id: x, lat: 51, lon: 4 }, { id: y, lat: 51 + dLat, lon: 4 }])
    const far = assignHues([{ id: x, lat: 51, lon: 4 }, { id: y, lat: 51 + dLat * 1.02, lon: 4 }])
    expect(near.get(y)).not.toBe(hueSlot(y))
    expect(far.get(y)).toBe(hueSlot(y))
  })
  it('a node without a position keeps its hash slot and pushes nobody', () => {
    const [x, y] = collidingPair()
    const hues = assignHues([{ id: x }, { id: y, lat: 51, lon: 4 }])
    expect(hues.get(x)).toBe(hueSlot(x))
    expect(hues.get(y)).toBe(hueSlot(y))
  })
})

// Signal strength is in the ray: stronger is brighter and wider, over the
// legend's scale of about -120 to -60 dBm.
describe('rayStrength and rayStyle', () => {
  it('runs 0 to 1 over -120..-60 and clamps outside', () => {
    expect(rayStrength(-120)).toBe(0)
    expect(rayStrength(-60)).toBe(1)
    expect(rayStrength(-90)).toBeCloseTo(0.5)
    expect(rayStrength(-140)).toBe(0)
    expect(rayStrength(-30)).toBe(1)
    expect(rayStrength(null)).toBe(0)
  })
  it('a stronger hearing is wider and more opaque', () => {
    const weak = rayStyle(-115), strong = rayStyle(-65)
    expect(strong.w).toBeGreaterThan(weak.w)
    expect(strong.op).toBeGreaterThan(weak.op)
    expect(weak.op).toBeGreaterThan(0)
    expect(strong.op).toBeLessThanOrEqual(1)
  })
  it('one way is the same ray at ONE_WAY_OPACITY, two way at full; a dimmed star at DIM_OPACITY', () => {
    const two = rayStyle(-80, { twoWay: true }), one = rayStyle(-80, { twoWay: false })
    expect(one.w).toBe(two.w)
    // The ratios are the decision (Kasper, 2026-09-08), pinned as numbers so
    // a changed constant is a changed test, not a green one.
    expect(one.op).toBeCloseTo(two.op * 0.4)
    expect(ONE_WAY_OPACITY).toBe(0.4)
    const dim = rayStyle(-80, { twoWay: true, dimmed: true })
    expect(dim.op).toBeCloseTo(two.op * 0.25)
    expect(DIM_OPACITY).toBe(0.25)
    expect(dim.w).toBe(two.w)
  })
})

// The hub: the advertised position when there is one, the RSSI estimate
// otherwise; a 0,0 is no position.
describe('starOrigin', () => {
  it('prefers the advertised position, falls back to the estimate, refuses 0,0', () => {
    expect(starOrigin({ advertised: { lat: 51, lon: 4 }, estimate: { centroid: { lat: 51.1, lon: 4.1 } } })).toEqual({ lat: 51, lon: 4, kind: 'advertised' })
    expect(starOrigin({ advertised: null, estimate: { centroid: { lat: 51.1, lon: 4.1 } } })).toEqual({ lat: 51.1, lon: 4.1, kind: 'estimate' })
    expect(starOrigin({ advertised: { lat: 0, lon: 0 }, estimate: null })).toBeNull()
    expect(starOrigin({})).toBeNull()
  })
})

const ring = (id, kind, n, role = null) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * 2 * Math.PI
  return { lat: 51 + Math.sin(a) * 0.004, lon: 4 + Math.cos(a) * 0.006, rssi: -70 - i * 5, sender_id: id, sender_kind: kind, sender_role: role }
})

describe('coverageStars', () => {
  it('groups the repeater hearings by id and hangs each star from its origin', () => {
    const pts = [...ring(A, 'advert_pubkey', 6, 'Repeater'), ...ring(B, 'relay', 4), ...ring('cc'.repeat(32), 'advert_pubkey', 3, 'Companion')]
    const stars = coverageStars(pts, { positionOf: (id) => (id === A ? { lat: 51.0005, lon: 4.0005 } : null) })
    expect(stars.map((s) => s.id)).toEqual([A, B])
    expect(stars[0].origin).toEqual({ lat: 51.0005, lon: 4.0005, kind: 'advertised' })
    expect(stars[0].points).toHaveLength(6)
    expect(stars[1].origin.kind).toBe('estimate')
    expect(stars[1].points).toHaveLength(4)
  })
  it('keys the id case-insensitively and drops a star with no origin', () => {
    const pts = [...ring(A, 'relay', 2), ...ring(A.toUpperCase(), 'relay', 2)]
    // Four hearings share an id: enough for one star; with no registry
    // position and too few inliers for an estimate the star has no hub.
    const stars = coverageStars(pts, { positionOf: () => null, estimate: () => null })
    expect(stars).toEqual([])
    const withHub = coverageStars(pts, { positionOf: () => ({ lat: 51, lon: 4 }) })
    expect(withHub).toHaveLength(1)
    expect(withHub[0].points).toHaveLength(4)
  })
  it('skips hearings without a fix', () => {
    const pts = [{ lat: null, lon: null, rssi: -70, sender_id: A, sender_kind: 'relay' }, ...ring(A, 'relay', 1)]
    const stars = coverageStars(pts, { positionOf: () => ({ lat: 51, lon: 4 }) })
    expect(stars[0].points).toHaveLength(1)
  })
})

describe('coverageFeatures', () => {
  const star = (id, kind) => ({ id, origin: { lat: 51, lon: 4, kind: 'advertised' }, points: [{ lat: 51.01, lon: 4.01, rssi: -70, sender_kind: kind }, { lat: 50.99, lon: 3.99, rssi: -110, sender_kind: 'relay' }] })
  const colorOf = (slot) => `hue-${slot}`
  it('draws one ray per hearing in the repeater hue, strength in width and opacity, alt for 3D', () => {
    const fc = coverageFeatures([star(A, 'trace_reply')], { slotOf: () => 3, colorOf })
    expect(fc.features).toHaveLength(2)
    const [two, one] = fc.features.map((f) => f.properties)
    expect(two.color).toBe('hue-3'); expect(one.color).toBe('hue-3')
    expect(two.id).toBe(A)
    expect(two.two).toBe(true); expect(one.two).toBe(false)
    expect(two.w).toBeGreaterThan(one.w)
    expect(two.op).toBeGreaterThan(one.op)
    expect(two.alt).toBe(RAY_ALT_M)
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[4, 51], [4.01, 51.01]] })
  })
  it('a selection keeps the chosen star as it is and dims every other one', () => {
    const fc = coverageFeatures([star(A, 'relay'), star(B, 'relay')], { slotOf: () => 0, colorOf, selected: new Set([A]) })
    const a = fc.features.filter((f) => f.properties.id === A), b = fc.features.filter((f) => f.properties.id === B)
    expect(a[0].properties.op).toBeCloseTo(rayStyle(-70, { twoWay: false }).op)
    expect(b[0].properties.op).toBeCloseTo(rayStyle(-70, { twoWay: false }).op * DIM_OPACITY)
    expect(a[0].properties.dim).toBe(false); expect(b[0].properties.dim).toBe(true)
  })
  it('an empty selection dims nobody', () => {
    const fc = coverageFeatures([star(A, 'relay')], { slotOf: () => 0, colorOf, selected: new Set() })
    expect(fc.features[0].properties.dim).toBe(false)
  })
})
