import { describe, it, expect } from 'vitest'
import { TRACE_TTL_MS, normalizeTag, rememberPing, prunePings, matchTraceTarget } from '../tracetag.js'
import { traceTagOf, classifyReception, hexToBytes, heardUsSnr } from '../meshpacket.js'
import { decodePacket } from '../decode.js'
import { buildRecord } from '../capture.js'

const T0 = Date.parse('2026-08-24T12:00:00Z')
const pk = (head) => head + '0'.repeat(64 - head.length)

describe('normalizeTag', () => {
  it('renders a 32-bit tag the way the decoder reports it: 8 lowercase hex', () => {
    expect(normalizeTag(0x44332211)).toBe('44332211')
    expect(normalizeTag(5)).toBe('00000005')
    expect(normalizeTag('FFFFFFFF')).toBe('ffffffff')
  })
  it('refuses anything that is not a tag', () => {
    expect(normalizeTag(null)).toBeNull()
    expect(normalizeTag('zz')).toBeNull()
    expect(normalizeTag(-1)).toBeNull()
  })
})

// The tag is the whole basis for the attribution: we generated it, so a packet
// carrying it is certainly the retransmission of our own probe.
describe('matchTraceTarget', () => {
  const pending = () => rememberPing([], 0x44332211, pk('ab12'), T0)

  it('names the target the tag was sent to', () => {
    expect(matchTraceTarget(pending(), '44332211', T0 + 500)).toBe(pk('ab12'))
  })
  it('accepts the tag in either notation, since one side is ours and one is the decoder\'s', () => {
    expect(matchTraceTarget(pending(), 0x44332211, T0 + 500)).toBe(pk('ab12'))
    expect(matchTraceTarget(pending(), '44332211'.toUpperCase(), T0 + 500)).toBe(pk('ab12'))
  })
  it('says nothing about a tag it never sent', () => {
    expect(matchTraceTarget(pending(), 'deadbeef', T0 + 500)).toBeNull()
  })
  it('stops matching once the ping has expired', () => {
    expect(matchTraceTarget(pending(), '44332211', T0 + TRACE_TTL_MS - 1)).toBe(pk('ab12'))
    expect(matchTraceTarget(pending(), '44332211', T0 + TRACE_TTL_MS)).toBeNull()
  })

  // The trace path addresses its first hop by ONE byte of the target's id
  // (buildTracePathFrame), so every node whose id starts with that byte answers.
  // With two such nodes pinged at once the tag still names the ping, but not
  // which of them retransmitted it — refuse rather than pick.
  it('refuses when two live pings address the same first byte', () => {
    let p = rememberPing([], 0x44332211, pk('ab12'), T0)
    p = rememberPing(p, 0x99887766, pk('ab99'), T0)
    expect(matchTraceTarget(p, '44332211', T0 + 500)).toBeNull()
  })
  it('is unbothered by a second ping to a different first byte', () => {
    let p = rememberPing([], 0x44332211, pk('ab12'), T0)
    p = rememberPing(p, 0x99887766, pk('cd34'), T0)
    expect(matchTraceTarget(p, '44332211', T0 + 500)).toBe(pk('ab12'))
  })
  it('ignores an expired same-byte ping when judging ambiguity', () => {
    let p = rememberPing([], 0x99887766, pk('ab99'), T0)
    p = rememberPing(p, 0x44332211, pk('ab12'), T0 + TRACE_TTL_MS)
    expect(matchTraceTarget(p, '44332211', T0 + TRACE_TTL_MS + 1)).toBe(pk('ab12'))
  })
})

describe('rememberPing / prunePings', () => {
  it('keeps the list from growing without bound', () => {
    let p = []
    for (let i = 0; i < 5; i++) p = rememberPing(p, i + 1, pk(String(i) + '1'), T0 + i * 1000)
    expect(p).toHaveLength(5)
    expect(prunePings(p, T0 + TRACE_TTL_MS + 2500)).toHaveLength(2)
  })
  it('does not mutate the list it is given', () => {
    const p = rememberPing([], 1, pk('ab'), T0)
    rememberPing(p, 2, pk('cd'), T0)
    expect(p).toHaveLength(1)
  })
})

// The decoder reports a TRACE packet's tag as an 8-char hex string, uppercase
// for hex letters, and leaves it absent on every other type.
describe('traceTagOf', () => {
  const trace = (tag) => ({ payloadType: 9, payload: { decoded: { traceTag: tag } } })

  it('reads the tag off a decoded TRACE packet, lowercased', () => {
    expect(traceTagOf(trace('FFFFFFFF'))).toBe('ffffffff')
    expect(traceTagOf(trace('00000005'))).toBe('00000005')
  })
  it('returns null where there is no tag to read', () => {
    expect(traceTagOf({ payloadType: 4, payload: { decoded: { publicKey: 'ab' } } })).toBeNull()
    expect(traceTagOf(null)).toBeNull()
    expect(traceTagOf({ payload: {} })).toBeNull()
  })
})

// The units above are each pinned; this is the sequence app.js runs per frame,
// composed from the same pieces. It is the only place that shows the tag
// surviving the round trip through the real decoder rather than through a
// fixture we wrote to match our own expectations.
describe('a trace reply through the capture path (#481)', () => {
  const gps = { lat: 51.5, lon: 4.5, acc_m: 8 }

  // A TRACE retransmission as the firmware emits it: DIRECT route, one path byte
  // (the hop's SNR * 4, appended by Mesh.cpp before forwarding), and a payload of
  // tag(4 LE) + authCode(4) + flags(1) + the 1-byte path hash we addressed.
  const traceHex = (tag) => {
    const b = [(9 << 2) | 0x02, 0x01, 0xf0,
      tag & 0xff, (tag >>> 8) & 0xff, (tag >>> 16) & 0xff, (tag >>> 24) & 0xff,
      0, 0, 0, 0, 0x00, 0xab]
    return b.map((x) => x.toString(16).padStart(2, '0')).join('')
  }

  it('turns an anonymous TRACE reception into a measurement of the node we asked', () => {
    const hex = traceHex(0x44332211)
    const decoded = decodePacket(hex)
    const bare = classifyReception(decoded)
    expect(bare.packetType).toBe('Trace')
    expect(bare.sender.id).toBeNull()          // classifyReception refuses TRACE, correctly

    const pending = rememberPing([], 0x44332211, pk('ab12'), T0)
    const target = matchTraceTarget(pending, traceTagOf(decoded), T0 + 500)
    expect(target).toBe(pk('ab12'))

    const frame = { snr: -4.25, rssi: -97, raw: hexToBytes(hex) }
    const cls = { ...bare, sender: { kind: 'trace_reply', id: target, label: null, role: null } }
    const rec = buildRecord(frame, cls, gps, '2026-08-24T12:00:00Z')
    expect(rec.sender_id).toBe(pk('ab12'))
    expect(rec.sender_label).toBeNull()        // an id is not a name
    expect(rec.packet_type).toBe('Trace')
    expect(rec.rssi).toBe(-97)
    expect(rec.lat).toBe(51.5)
  })

  it('leaves an overheard trace anonymous, tag or no tag', () => {
    const decoded = decodePacket(traceHex(0xdeadbeef))
    const pending = rememberPing([], 0x44332211, pk('ab12'), T0)
    expect(matchTraceTarget(pending, traceTagOf(decoded), T0 + 500)).toBeNull()
  })
})

// #482 rides on #481's match: the reciprocal reading is only meaningful for a
// reply we provoked, so it is attached where the tag is recognised and nowhere
// else. This is the same sequence app.js runs, with that step included.
describe('the reciprocal SNR travels with the attribution (#482)', () => {
  const gps = { lat: 51.5, lon: 4.5, acc_m: 8 }
  const hex = ['26', '01', 'f0', '11223344', '00000000', '00', 'ab'].join('')

  it('records what the target heard us at, next to what we heard it at', () => {
    const decoded = decodePacket(hex)
    const pending = rememberPing([], 0x44332211, pk('ab12'), T0)
    const target = matchTraceTarget(pending, traceTagOf(decoded), T0 + 500)
    expect(target).toBe(pk('ab12'))

    const cls = { ...classifyReception(decoded), heardUsSnr: heardUsSnr(decoded),
      sender: { kind: 'trace_reply', id: target, label: null, role: null } }
    const rec = buildRecord({ snr: -4.25, rssi: -97, raw: hexToBytes(hex) }, cls, gps, '2026-08-24T12:00:00Z')
    expect(rec.heard_us_snr).toBe(-4)     // theirs, from the path byte
    expect(rec.snr).toBe(-4.25)           // ours, from the 0x88 header
    expect(rec.sender_id).toBe(pk('ab12'))
  })

  it('leaves the field null on a trace nobody asked for', () => {
    const decoded = decodePacket(hex)
    expect(matchTraceTarget([], traceTagOf(decoded), T0)).toBeNull()
    const rec = buildRecord({ snr: -4.25, rssi: -97, raw: hexToBytes(hex) },
      classifyReception(decoded), gps, '2026-08-24T12:00:00Z')
    expect(rec.heard_us_snr).toBeNull()
    expect(rec.sender_id).toBeNull()
  })
})
