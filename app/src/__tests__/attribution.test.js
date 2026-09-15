import { describe, it, expect } from 'vitest'
import {
  REACH_CAP_KM, reachKm, attributableId, registryIndex, attributeReception, attributionSignature,
} from '../attribution.js'

// #661: a relay id belongs to a registry node unless there is evidence of a
// collision. Reach is how far a signal this strong can have come from.
describe('reachKm', () => {
  it('is the free-space distance of a 36 dB budget at 868 MHz, capped at 15 km', () => {
    // The reference numbers of the decision (Kasper, 2026-09-14).
    expect(reachKm(-70)).toBeCloseTo(5.49, 2)
    expect(reachKm(-75)).toBeCloseTo(9.76, 2)
    expect(reachKm(-78)).toBeCloseTo(13.79, 2)
    expect(reachKm(-79)).toBe(15)
    expect(reachKm(-120)).toBe(15)
    expect(REACH_CAP_KM).toBe(15)
  })
  it('treats a missing RSSI as the full reach', () => {
    expect(reachKm(null)).toBe(15)
    expect(reachKm(NaN)).toBe(15)
  })
})

describe('attributableId', () => {
  it('takes relay, path_hash and direct_hash ids of 1, 2 or 3 bytes, lowercased', () => {
    expect(attributableId({ sender_kind: 'relay', sender_id: '4A4A' })).toBe('4a4a')
    expect(attributableId({ sender_kind: 'relay', sender_id: '4a4abe' })).toBe('4a4abe')
    expect(attributableId({ sender_kind: 'path_hash', sender_id: '64' })).toBe('64')
    expect(attributableId({ sender_kind: 'direct_hash', sender_id: '4a' })).toBe('4a')
  })
  it('leaves every other kind and length to its own rule', () => {
    expect(attributableId({ sender_kind: 'advert_pubkey', sender_id: 'aa'.repeat(32) })).toBeNull()
    expect(attributableId({ sender_kind: 'discover_pubkey', sender_id: 'aa'.repeat(8) })).toBeNull()
    expect(attributableId({ sender_kind: 'channel_name', sender_id: 'ab' })).toBeNull()
    expect(attributableId({ sender_kind: 'trace_reply', sender_id: '4a4a' })).toBeNull()
    expect(attributableId({ sender_kind: 'relay', sender_id: '4a4abe11' })).toBeNull()
    expect(attributableId({ sender_kind: 'relay', sender_id: 'aa'.repeat(32) })).toBeNull()
    expect(attributableId({ sender_kind: 'relay', sender_id: '4a4' })).toBeNull()
    expect(attributableId({ sender_kind: 'relay', sender_id: null })).toBeNull()
    expect(attributableId(null)).toBeNull()
  })
})

// Fixtures in kilometres north or east of (51, 4), the equirectangular metre the
// rule measures in, so a boundary case sits where the test says it does. A
// degree of longitude at 51 N is cos(51) of a degree of latitude, about 0.63.
const HOME = { lat: 51, lon: 4 }
const north = (km) => ({ lat: HOME.lat + (km * 1000) / 111320, lon: HOME.lon })
const east = (km) => ({ lat: HOME.lat, lon: HOME.lon + (km * 1000) / (111320 * Math.cos((HOME.lat * Math.PI) / 180)) })
const node = (pubkey, km, name = '') => ({ pubkey, name, ...north(km) })
const heard = (kind, id, rssi) => ({ sender_kind: kind, sender_id: id, rssi, ...HOME })

const A_KEY = '64aa' + 'aa'.repeat(30)
const B_KEY = '64bb' + 'bb'.repeat(30)

describe('attributeReception', () => {
  it('gives a reception to the one node with that prefix within reach', () => {
    const A = node(A_KEY, 8, 'Heumensoord-RPT')
    const attr = attributeReception(heard('path_hash', '64', -90), { index: registryIndex([A]) })
    expect(attr.rule).toBe('node')
    expect(attr.node).toBe(A)
  })
  it('calls two candidates within reach a collision', () => {
    const index = registryIndex([node(A_KEY, 8), node(B_KEY, 12)])
    expect(attributeReception(heard('path_hash', '64', -90), { index })).toEqual({ rule: 'collision', count: 2 })
    const C_KEY = '64cc' + 'cc'.repeat(30)
    const three = registryIndex([node(A_KEY, 8), node(B_KEY, 12), node(C_KEY, 3)])
    expect(attributeReception(heard('path_hash', '64', -90), { index: three })).toEqual({ rule: 'collision', count: 3 })
    // At -72 dBm the reach is about 6.9 km: B at 12 km is out of it.
    const A = node(A_KEY, 5)
    const near = attributeReception(heard('path_hash', '64', -72), { index: registryIndex([A, node(B_KEY, 12)]) })
    expect(near.rule).toBe('node')
    expect(near.node).toBe(A)
  })
  it('is an estimate when the only candidate is out of reach', () => {
    const attr = attributeReception(heard('path_hash', '64', -90), { index: registryIndex([node(A_KEY, 20)]) })
    expect(attr.rule).toBe('estimate')
  })
  it('is an estimate with no registry, as a guest has', () => {
    expect(attributeReception(heard('path_hash', '64', -90), { index: null })).toEqual({ rule: 'estimate', prefixKnown: false })
    expect(attributeReception(heard('path_hash', '64', -90))).toEqual({ rule: 'estimate', prefixKnown: false })
  })
  // A positioned node with that prefix out of reach is evidence that a
  // resolver's name for the id belongs to a node you did not hear (Kasper,
  // 2026-09-15); a node without a position is nothing reach can contradict.
  it('says whether the registry holds a positioned node with that prefix out of reach', () => {
    const far = attributeReception(heard('relay', '64aa', -90), { index: registryIndex([node(A_KEY, 20)]) })
    expect(far).toEqual({ rule: 'estimate', prefixKnown: true })
    const other = attributeReception(heard('relay', '64aa', -90), { index: registryIndex([node(B_KEY, 20)]) })
    expect(other).toEqual({ rule: 'estimate', prefixKnown: false })
    const unpositioned = { pubkey: A_KEY, name: 'x', lat: null, lon: null }
    const none = attributeReception(heard('relay', '64aa', -90), { index: registryIndex([unpositioned]) })
    expect(none).toEqual({ rule: 'estimate', prefixKnown: false })
  })
  it('uses the plotted RSSI, so the offset shrinks the reach', () => {
    const index = registryIndex([node(A_KEY, 8)])
    expect(attributeReception(heard('path_hash', '64', -90), { index, offsetDb: 0 }).rule).toBe('node')
    expect(attributeReception(heard('path_hash', '64', -90), { index, offsetDb: 20 }).rule).toBe('estimate')
  })
  it('treats a reception without an RSSI as heard from the full reach', () => {
    const index = registryIndex([node(A_KEY, 14)])
    expect(attributeReception(heard('path_hash', '64', null), { index }).rule).toBe('node')
    expect(attributeReception(heard('path_hash', '64', null), { index, offsetDb: 20 }).rule).toBe('node')
  })
  // At -72 dBm the reach is about 6.9 km. 6 km due east is inside it only when
  // a degree of longitude is shortened by the latitude: without that it reads
  // 9.5 km.
  it('measures reach east-west at the reception\'s latitude', () => {
    const A = { pubkey: A_KEY, name: '', ...east(6) }
    const inside = attributeReception(heard('path_hash', '64', -72), { index: registryIndex([A]) })
    expect(inside.rule).toBe('node')
    expect(inside.node).toBe(A)
    const far = { pubkey: A_KEY, name: '', ...east(8) }
    expect(attributeReception(heard('path_hash', '64', -72), { index: registryIndex([far]) }).rule).toBe('estimate')
  })
  it('decides at the reach boundary', () => {
    expect(attributeReception(heard('path_hash', '64', -100), { index: registryIndex([node(A_KEY, 14.9)]) }).rule).toBe('node')
    expect(attributeReception(heard('path_hash', '64', -100), { index: registryIndex([node(A_KEY, 15.1)]) }).rule).toBe('estimate')
  })
  // No float lands a node exactly 15 km out, so the inclusive edge is pinned
  // where it is exact by construction: an RSSI no radio reports underflows the
  // reach to 0 km, and a node on the reception's own spot sits right on it.
  it('counts a node exactly on the reach as within it', () => {
    expect(reachKm(10000)).toBe(0)
    expect(attributeReception(heard('path_hash', '64', 10000), { index: registryIndex([node(A_KEY, 0)]) }).rule).toBe('node')
  })
  it('matches the prefix case-insensitively', () => {
    const A = node(A_KEY.toUpperCase(), 8)
    const attr = attributeReception(heard('relay', '64aa', -90), { index: registryIndex([A]) })
    expect(attr.rule).toBe('node')
    expect(attr.node).toBe(A)
    const a = node(A_KEY, 8)
    const upper = attributeReception(heard('relay', '64AA', -90), { index: registryIndex([a]) })
    expect(upper.rule).toBe('node')
    expect(upper.node).toBe(a)
  })
  // The server keeps the first of each exact key across upstreams, and the same
  // pubkey arrives upper-cased from some registries: that is one node, not two.
  it('counts one node listed twice, in two cases, once', () => {
    const A = node(A_KEY, 8)
    const attr = attributeReception(heard('path_hash', '64', -90), { index: registryIndex([A, node(A_KEY.toUpperCase(), 8)]) })
    expect(attr.rule).toBe('node')
    expect(attr.node).toBe(A)
  })
  it('applies to 2 and 3-byte relays and a 1-byte direct hash alike', () => {
    const C = node('4a4abe' + '11'.repeat(29), 3)
    const index = registryIndex([C, node('77' + '22'.repeat(31), 3)])
    for (const rec of [heard('relay', '4a4a', -90), heard('relay', '4a4abe', -90), heard('direct_hash', '4a', -90)]) {
      const attr = attributeReception(rec, { index })
      expect(attr.rule).toBe('node')
      expect(attr.node).toBe(C)
    }
  })
  it('returns null for a kind the rule does not cover', () => {
    const index = registryIndex([node(A_KEY, 1)])
    expect(attributeReception(heard('advert_pubkey', A_KEY, -90), { index })).toBeNull()
    expect(attributeReception(heard('relay', A_KEY.slice(0, 8), -90), { index })).toBeNull()
  })
})

// What a surface compares to know that a row reads differently now: the node
// it belongs to, or none for another reason.
describe('attributionSignature', () => {
  it('tells a node, another node, a collision and an estimate apart, and is equal for the same node on two row objects', () => {
    const A = node(A_KEY, 8), B = node(B_KEY, 8)
    const sig = (attr) => attributionSignature(attr)
    const all = [
      sig(null),
      sig({ rule: 'node', node: A }),
      sig({ rule: 'node', node: B }),
      sig({ rule: 'collision', count: 2 }),
      sig({ rule: 'estimate', prefixKnown: false }),
      sig({ rule: 'estimate', prefixKnown: true }),
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(sig({ rule: 'node', node: { ...A } })).toBe(sig({ rule: 'node', node: A }))
    expect(sig({ rule: 'node', node: { ...A, pubkey: A_KEY.toUpperCase() } })).toBe(sig({ rule: 'node', node: A }))
    expect(sig({ rule: 'collision', count: 3 })).toBe(sig({ rule: 'collision', count: 2 }))
  })
})
