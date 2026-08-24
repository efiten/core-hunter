import { describe, it, expect } from 'vitest'
import { classifyReception, carriesSignedIdentity, stripIdentity, undecodableReception } from '../meshpacket.js'
import { decodePacket } from '../decode.js'

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
  it('1-byte flood path hash excluded (collision-prone)', () => {
    const c = classifyReception({ payloadType: 0, pathLength: 1, routeType: 1, path: ['AB'], payload: { decoded: {} } })
    expect(c.sender.id).toBeNull()
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

// #454 classes 4 and 5. Both keep the reception and refuse only what the
// packet claims about itself, which is the split AGENTS §1 draws: RSSI, SNR
// and our own GPS fix cannot be forged, every identity in the header can.
describe('stripIdentity (#454 class 4)', () => {
  const advert = () => classifyReception(mk(4, { publicKey: 'AB'.repeat(32), appData: { name: 'Repeater-1', deviceRole: 2 } }))

  it('drops every part of the identity, keeping what was measured about the packet', () => {
    const bare = stripIdentity(advert())
    expect(bare.sender).toEqual({ kind: null, id: null, label: null, role: null })
    expect(bare.packetType).toBe('Advert')
    expect(bare.hops).toBe(0)
  })

  it('does not mutate the classification it was given', () => {
    const cls = advert()
    stripIdentity(cls)
    expect(cls.sender.id).toBe('ab'.repeat(32))
  })

  it('leaves a name nowhere on the record, not even as a label', () => {
    const bare = stripIdentity(advert())
    expect(JSON.stringify(bare)).not.toContain('Repeater-1')
  })
})

// A packet that does not decode has no type either. The decoder does not say
// so: its error paths return a fully-formed packet whose payloadType is a
// hardcoded RawCustom placeholder (packet-decoder.js, both catch branches), so
// running the error packet through classifyReception would file junk under the
// real "Raw" chip and claim pathLength 0 as a hop count. undecodableReception
// exists to keep that value out of the record.
describe('undecodableReception (#454 class 5)', () => {
  it('names the type Unknown rather than borrowing one from the decoder', () => {
    const c = undecodableReception()
    expect(c.packetType).toBe('Unknown')
    expect(c.sender).toEqual({ kind: null, id: null, label: null, role: null })
    expect(c.isDirect).toBe(false)
    expect(c.channel).toBeNull()
    expect(c.text).toBeNull()
  })

  it('is not the classification the decoder would hand us for the same packet', () => {
    const errorPacket = decodePacket('ff')            // too short: isValid false
    expect(errorPacket.isValid).toBe(false)
    expect(classifyReception(errorPacket).packetType).toBe('RawCustom')
    expect(undecodableReception().packetType).not.toBe('RawCustom')
  })
})
