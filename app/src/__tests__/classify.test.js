import { describe, it, expect } from 'vitest'
import { classifyReception, carriesSignedIdentity } from '../meshpacket.js'

const mk = (payloadType, decoded, pathLength = 0) => ({ payloadType, pathLength, payload: { decoded } })

describe('classifyReception', () => {
  it('advert → pubkey sender + name + role', () => {
    const c = classifyReception(mk(4, { publicKey: 'AB'.repeat(32), appData: { name: 'Repeater-1', deviceRole: 2 } }))
    expect(c.packetType).toBe('Advert')
    expect(c.isDirect).toBe(true)
    expect(c.sender).toEqual({ kind: 'advert_pubkey', id: 'ab'.repeat(32), role: 'Repeater', label: 'Repeater-1' })
  })
  it('discover/control reply → discover_pubkey: id + role from publicKey, label null', () => {
    const c = classifyReception(mk(11, { publicKey: '7B0E24700E0C0D3E', nodeTypeName: 'Sensor' }))
    expect(c.packetType).toBe('Control')
    expect(c.sender).toEqual({ kind: 'discover_pubkey', id: '7b0e24700e0c0d3e', role: 'Sensor', label: null })
  })
  it('direct message → direct_hash sender from sourceHash', () => {
    const c = classifyReception(mk(1, { sourceHash: '4A' }))
    expect(c.packetType).toBe('Response')
    expect(c.sender).toEqual({ kind: 'direct_hash', id: '4a', label: '4a' })
  })
  it('group text decrypted → channel_name sender + text + channel', () => {
    const c = classifyReception(
      mk(5, { channelHash: '8b', decrypted: { sender: 'Spammer', message: 'buy now' } }),
      (h) => (h === '8b' ? 'public' : null),
    )
    expect(c.packetType).toBe('GroupText')
    expect(c.channel).toBe('public')
    expect(c.sender).toEqual({ kind: 'channel_name', id: 'Spammer', label: 'Spammer' })
    expect(c.text).toBe('buy now')
  })
  it('group text without key → no sender, no text', () => {
    const c = classifyReception(mk(5, { channelHash: 'ff' }))
    expect(c.sender).toEqual({ kind: null, id: null, label: null })
    expect(c.text).toBeNull()
  })
  it('hops from pathLength; relayed non-flood not direct', () => {
    const c = classifyReception(mk(1, { sourceHash: 'aa' }, 3))
    expect(c.hops).toBe(3); expect(c.isDirect).toBe(false)
  })
  it('flood relay (hops>0, FLOOD) → relay sender from path[last], heard directly', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 2, routeType: 1, path: ['AABB', 'CCDD'], payload: { decoded: {} } })
    expect(c.sender).toEqual({ kind: 'relay', id: 'ccdd', role: null, label: null })
    expect(c.isDirect).toBe(true)
    expect(c.hops).toBe(2)
  })
  it('direct-route relay (hops>0, not FLOOD) → not attributed', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 2, routeType: 2, path: ['AABB', 'CCDD'], payload: { decoded: {} } })
    expect(c.sender.id).toBeNull(); expect(c.isDirect).toBe(false)
  })
  // Named rather than dropped since 2026-08-25. A 1-byte hash is still not an
  // identity, so it gets its own kind and carries the byte as its own label,
  // the way direct_hash does — never 'relay', which feed.js would offer as a
  // target and prefix-merge into every node sharing that byte.
  it('1-byte flood path hash → path_hash sender, id and label both the byte', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 1, routeType: 1, path: ['AB'], payload: { decoded: {} } })
    expect(c.sender).toEqual({ kind: 'path_hash', id: 'ab', role: null, label: 'ab' })
    expect(c.isDirect).toBe(true)
  })
  // The 2-byte boundary, from the other side: widening the path_hash branch to
  // `length <= 4` would swallow this one and lose a resolvable relay id.
  it('2-byte flood path hash stays a relay, with no label of its own', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 1, routeType: 1, path: ['ABCD'], payload: { decoded: {} } })
    expect(c.sender).toEqual({ kind: 'relay', id: 'abcd', role: null, label: null })
  })
  // The route check still gates it: a 1-byte hash on a DIRECT route is not the
  // immediate transmitter, so naming it would name the wrong node.
  it('1-byte path hash on a non-FLOOD route is still not attributed', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 1, routeType: 2, path: ['AB'], payload: { decoded: {} } })
    expect(c.sender.id).toBeNull(); expect(c.isDirect).toBe(false)
  })
  it('TRACE with a path is never attributed', () => {
    const c = classifyReception({ payloadType: 9, pathLength: 3, routeType: 1, path: ['AABB', 'CCDD', 'EEFF'], payload: { decoded: {} } })
    expect(c.sender.id).toBeNull(); expect(c.isDirect).toBe(false)
  })
})

// #356: an Advert is the one packet type carrying an identity — pubkey, name
// and self-reported position — and the one whose claim can be checked, since
// it is signed. Verification is async, so classifyReception (pure, sync) only
// says which classifications need it; the check itself happens in the capture
// path.
describe('carriesSignedIdentity', () => {
  it('is true for an advert, the only signed identity', () => {
    expect(carriesSignedIdentity({ sender: { kind: 'advert_pubkey', id: 'aa' } })).toBe(true)
  })

  it('is false for the kinds that carry no signature to check', () => {
    for (const kind of ['relay', 'discover_pubkey', 'channel_name', 'direct_hash', null]) {
      expect(carriesSignedIdentity({ sender: { kind, id: 'aa' } })).toBe(false)
    }
  })

  it('is total for junk input', () => {
    expect(carriesSignedIdentity(null)).toBe(false)
    expect(carriesSignedIdentity({})).toBe(false)
    expect(carriesSignedIdentity({ sender: null })).toBe(false)
  })
})
