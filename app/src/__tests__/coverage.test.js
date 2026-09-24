import { describe, it, expect } from 'vitest'
import {
  isRepeaterHearing, isTwoWay, hueSlot, assignHues, HUE_COUNT, NEAR_M,
  rayStrength, rayStyle, ONE_WAY_OPACITY, DIM_OPACITY,
  starOrigin, coverageStars, coverageFeatures, RAY_ALT_M, selectionDim, starKey, starSelected,
} from '../coverage.js'
import { estimateFor } from '../nodelayer.js'

const A = 'aa'.repeat(32), B = 'bb'.repeat(32)

// #603: which hearings a repeater's star is built from. The feed's repeater
// test, plus the Discover reply, which is a reply from the node itself, and
// since #661 a flood's 1-byte last hop, which reach can place on its node. A
// companion advert is not a repeater's hearing.
describe('isRepeaterHearing', () => {
  it('takes a Repeater role, a relay, a Discover reply and a trace reply', () => {
    expect(isRepeaterHearing({ sender_kind: 'advert_pubkey', sender_role: 'Repeater' })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'relay', sender_role: null })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'discover_pubkey', sender_role: null })).toBe(true)
    expect(isRepeaterHearing({ sender_kind: 'trace_reply' })).toBe(true)
  })
  it('takes a path hash: a flood\'s 1-byte last hop is a repeater', () => {
    expect(isRepeaterHearing({ sender_kind: 'path_hash', sender_id: '64', sender_role: null })).toBe(true)
  })
  it('leaves a direct hash out: zero hops is the originator, not a relay', () => {
    expect(isRepeaterHearing({ sender_kind: 'direct_hash', sender_id: '64', sender_role: null })).toBe(false)
  })
  it('leaves a companion advert and a channel name out', () => {
    expect(isRepeaterHearing({ sender_kind: 'advert_pubkey', sender_role: 'Companion' })).toBe(false)
    expect(isRepeaterHearing({ sender_kind: 'channel_name' })).toBe(false)
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

  // The estimate sorts a star's hearings and is most of a draw (#593 review:
  // 2.1 ms a call on a 4559-hearing export), and the app draws once a second
  // from a fresh read of the store. A cache the caller keeps between draws
  // reuses a star's estimate while its hearings are the same ones.
  describe('with a cache', () => {
    const C = 'cc'.repeat(32)
    const read = (pts) => pts.map((p) => ({ ...p }))   // the next tick's read: same values, new objects
    const counted = () => {
      const calls = []
      return { calls, estimate: (pts) => { calls.push(pts.length); return estimateFor(pts) } }
    }
    const pts = [...ring(A, 'relay', 6), ...ring(B, 'relay', 4), ...ring(C, 'relay', 2)]
    it('reuses every estimate while the hearings are unchanged, and hangs the stars from the new read', () => {
      const cache = new Map(), { calls, estimate } = counted()
      const first = coverageStars(pts, { estimate, cache })
      expect(calls).toEqual([6, 4, 2])
      const next = read(pts)
      const second = coverageStars(next, { estimate, cache })
      expect(calls).toEqual([6, 4, 2])
      // C has too few hearings for an estimate: still no star, still not recomputed.
      expect(second.map((s) => s.id)).toEqual([A, B])
      expect(second.map((s) => s.origin)).toEqual(first.map((s) => s.origin))
      expect(second[0].points[0]).toBe(next[0])
    })
    it('recomputes only the star whose hearings changed: one more, one fewer, or another RSSI on the same spot', () => {
      const cache = new Map(), { calls, estimate } = counted()
      const origins = (stars) => stars.map((s) => s.origin)
      coverageStars(pts, { estimate, cache })
      calls.length = 0
      const more = [...read(pts), { ...pts[0], lat: 51.003 }]
      expect(origins(coverageStars(more, { estimate, cache }))).toEqual(origins(coverageStars(more)))
      expect(calls).toEqual([7])
      calls.length = 0
      // A's last hearing ages out of the window.
      const fewer = read(pts).filter((p, i) => i !== 5)
      const before = coverageStars(fewer, { estimate, cache })
      expect(origins(before)).toEqual(origins(coverageStars(fewer)))
      expect(calls).toEqual([5])
      calls.length = 0
      const louder = read(fewer)
      const first = louder.findIndex((p) => p.sender_id === B)
      louder[first] = { ...louder[first], rssi: -40 }
      const fromCache = coverageStars(louder, { estimate, cache })
      expect(calls).toEqual([4])
      const b = (stars) => stars.find((s) => s.id === B).origin
      expect(b(coverageStars(louder))).not.toEqual(b(before))
      expect(b(fromCache)).toEqual(b(coverageStars(louder)))
    })
    it('keeps only the stars of the last read', () => {
      const cache = new Map()
      coverageStars(pts, { cache })
      coverageStars(ring(A, 'relay', 6), { cache })
      expect([...cache.keys()]).toEqual([A])
    })
  })
})

// #661: a hearing whose relay id belongs to one registry node in reach is that
// node's hearing, so it hangs from the node's star; a collided one belongs to
// no star; the rest keep a star of their own id, estimated over those alone
// (Kasper, 2026-09-15: a node's hearings never pull another transmitter's
// estimate of the same id toward it).
describe('coverageStars with attribution', () => {
  const N = { pubkey: ('4a4abe' + '11'.repeat(29)).toUpperCase(), name: 'Heumensoord-RPT', lat: 51.0004, lon: 4.0003 }
  const nKey = N.pubkey.toLowerCase()
  const toN = (pt) => (pt.sender_kind === 'relay' ? { rule: 'node', node: N } : null)
  const ringAt = (center, id, kind, n) => ring(id, kind, n).map((p) => ({ ...p, lat: p.lat - 51 + center.lat, lon: p.lon - 4 + center.lon }))

  it('hangs an attributed hearing from its node, keyed by the pubkey, advertised', () => {
    const stars = coverageStars(ring('4a4a', 'relay', 4), { positionOf: () => null, attributionOf: toN })
    expect(stars.map((s) => s.id)).toEqual([nKey])
    expect(stars[0].origin).toEqual({ lat: N.lat, lon: N.lon, kind: 'advertised' })
    expect(stars[0].points).toHaveLength(4)
  })
  it('puts an attributed relay in the same star as the node\'s own Repeater advert', () => {
    const pts = [...ring(nKey, 'advert_pubkey', 3, 'Repeater'), ...ring('4a4a', 'relay', 4)]
    const stars = coverageStars(pts, { positionOf: () => null, attributionOf: toN })
    expect(stars.map((s) => s.id)).toEqual([nKey])
    expect(stars[0].points).toHaveLength(7)
  })
  it('leaves a collided hearing out of every star', () => {
    const pts = [...ring('4a4a', 'relay', 4), ...ring(B, 'relay', 4)]
    const stars = coverageStars(pts, {
      positionOf: () => ({ lat: 51, lon: 4 }),
      attributionOf: (pt) => (pt.sender_id === '4a4a' ? { rule: 'collision', count: 2 } : null),
    })
    expect(stars.map((s) => s.id)).toEqual([B])
  })
  it('keys an unattributed hearing by its own id, as before', () => {
    const pts = ring('4A4A', 'relay', 4)
    for (const attributionOf of [() => null, () => ({ rule: 'estimate', prefixKnown: true })]) {
      const stars = coverageStars(pts, { positionOf: () => null, attributionOf })
      expect(stars.map((s) => s.id)).toEqual(['4a4a'])
      expect(stars[0].origin.kind).toBe('estimate')
    }
  })
  it('hangs a placed 1-byte last hop from its node, and no direct hash from anything', () => {
    const toNode = () => ({ rule: 'node', node: N })
    const pts = [...ring('4a', 'path_hash', 4), ...ring('4a', 'direct_hash', 3)]
    const stars = coverageStars(pts, { positionOf: () => null, attributionOf: toNode })
    expect(stars.map((s) => s.id)).toEqual([nKey])
    expect(stars[0].points.map((p) => p.sender_kind)).toEqual(['path_hash', 'path_hash', 'path_hash', 'path_hash'])
  })
  it('does not blend a node\'s hearings into the estimate of the same raw id elsewhere', () => {
    const far = { lat: 51.3, lon: 4.2 }
    const nearN = ring('4a4a', 'relay', 5)
    const elsewhere = ringAt(far, '4a4a', 'relay', 5)
    const attributionOf = (pt) => (nearN.includes(pt) ? { rule: 'node', node: N } : { rule: 'estimate', prefixKnown: true })
    const stars = coverageStars([...nearN, ...elsewhere], { positionOf: () => null, attributionOf })
    expect(stars.map((s) => s.id).sort()).toEqual(['4a4a', nKey].sort())
    const own = stars.find((s) => s.id === '4a4a')
    expect(own.points).toHaveLength(5)
    expect(own.points.every((p) => elsewhere.includes(p))).toBe(true)
    const alone = estimateFor(elsewhere.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi })))
    expect(own.origin).toEqual({ lat: alone.centroid.lat, lon: alone.centroid.lon, kind: 'estimate' })
  })
})

describe('starKey', () => {
  it('is the node\'s pubkey for an attributed hearing, nothing for a collision, else the id', () => {
    const pt = { sender_id: '4A4A', sender_kind: 'relay' }
    expect(starKey(pt, { rule: 'node', node: { pubkey: 'AB'.repeat(32) } })).toBe('ab'.repeat(32))
    expect(starKey(pt, { rule: 'collision', count: 2 })).toBeNull()
    expect(starKey(pt, { rule: 'estimate', prefixKnown: false })).toBe('4a4a')
    expect(starKey(pt, null)).toBe('4a4a')
  })
})


// A pick is a raw id (the app's selection, the map's picker), while a star is
// keyed by its node once a hearing is attributed. Either names the star.
describe('starSelected', () => {
  it('selects a star by its own id or by the raw id of any hearing in it', () => {
    const star = { id: A, points: [{ sender_id: A, sender_kind: 'advert_pubkey' }, { sender_id: '64AA', sender_kind: 'relay' }] }
    expect(starSelected(star, new Set([A]))).toBe(true)
    expect(starSelected(star, new Set(['64aa']))).toBe(true)
    expect(starSelected(star, new Set(['77']))).toBe(false)
    expect(starSelected(star, new Set())).toBe(false)
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
  it('a star picked by the raw id of a hearing in it keeps its strength', () => {
    const attributed = { id: A, origin: { lat: 51, lon: 4, kind: 'advertised' }, points: [{ lat: 51.01, lon: 4.01, rssi: -70, sender_kind: 'relay', sender_id: '64aa' }] }
    const fc = coverageFeatures([attributed, star(B, 'relay')], { slotOf: () => 0, colorOf, selected: new Set(['64aa']) })
    expect(fc.features.find((f) => f.properties.id === A).properties.dim).toBe(false)
    expect(fc.features.find((f) => f.properties.id === B).properties.dim).toBe(true)
  })
  it('an empty selection dims nobody', () => {
    const fc = coverageFeatures([star(A, 'relay')], { slotOf: () => 0, colorOf, selected: new Set() })
    expect(fc.features[0].properties.dim).toBe(false)
  })
})

// #624: the selection used to dim the other stars' rays and nothing else, so
// the other repeaters' dots kept full colour on top of their own dimmed rays.
// One factor now answers for every layer that draws receptions, and for the
// trail, which belongs to no repeater.
describe('selectionDim', () => {
  it('dims nothing while there is no selection, whatever it is asked about', () => {
    for (const id of [A, B, null]) {
      expect(selectionDim(null, id)).toBe(1)
      expect(selectionDim(new Set(), id)).toBe(1)
    }
  })

  it('keeps what belongs to a selected repeater at full strength', () => {
    expect(selectionDim(new Set([A]), A)).toBe(1)
  })

  it('dims what belongs to any other repeater', () => {
    expect(selectionDim(new Set([A]), B)).toBe(DIM_OPACITY)
  })

  it('dims what belongs to no repeater at all, the trail and a companion included', () => {
    // The case that separates "one dim rule for the whole map" from "dim the
    // other stars": with a selection, a thing with no repeater is not part of
    // it, so it steps back like everything else rather than staying lit.
    expect(selectionDim(new Set([A]), null)).toBe(DIM_OPACITY)
    expect(selectionDim(new Set([A]), undefined)).toBe(DIM_OPACITY)
  })

  it('matches an upper-cased id to its lower-cased selection', () => {
    // Some resolvers hand the same pubkey back upper-cased; the selection
    // holds it lower-cased, so without folding the selected repeater's own
    // dots would dim along with everything else.
    expect(selectionDim(new Set([A]), A.toUpperCase())).toBe(1)
  })
})
