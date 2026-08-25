import { describe, it, expect } from 'vitest'
import { buildRecord, shouldCapture } from '../capture.js'
import { classifyReception } from '../meshpacket.js'

describe('buildRecord', () => {
  it('flattens frame + classification + gps; no decrypted text', () => {
    const frame = { snr: -3.5, rssi: -92, raw: new Uint8Array([0xde, 0xad]) }
    const cls = { packetType: 'GroupText', hops: 0, isDirect: true,
      sender: { kind: 'channel_name', id: 'Spammer', label: 'Spammer' }, channel: 'public', text: 'buy now' }
    const rec = buildRecord(frame, cls, { lat: 51, lon: 4, acc_m: 8 }, '2026-06-29T10:00:00Z', 'aabbcc')
    expect(rec).toEqual({
      rx_at: '2026-06-29T10:00:00Z', rx_pubkey: 'aabbcc', raw: 'dead', snr: -3.5, rssi: -92, lat: 51, lon: 4, acc_m: 8,
      sender_kind: 'channel_name', sender_id: 'Spammer', sender_label: 'Spammer', sender_role: null, channel_name: 'public',
      is_direct: true, hops: 0, packet_type: 'GroupText',
    })
    expect('text' in rec).toBe(false)
  })

  // #454: the reception is stamped with the companion that heard it, at capture
  // time. It used to be supplied at publish time from live BLE state, which a
  // deliberate disconnect clears -- so a queue full of real receptions became
  // unpublishable the moment someone tidied up, and two hours of driving
  // reached the server as ten minutes.
  it('stamps the companion that heard it, so the row can outlive the link', () => {
    const frame = { snr: -3, rssi: -90, raw: new Uint8Array([0x01]) }
    const cls = { packetType: 'Advert', hops: 0, isDirect: true, sender: { kind: null, id: null, label: null }, channel: null }
    const gps = { lat: 51, lon: 4, acc_m: 8 }
    expect(buildRecord(frame, cls, gps, 'x', 'AABB').rx_pubkey).toBe('AABB')
    // Never undefined: a row with no pubkey field at all would look like one
    // stored before the stamp existed, and be published under whatever the
    // caller happened to be holding.
    expect(buildRecord(frame, cls, gps, 'x').rx_pubkey).toBe('')
    expect(buildRecord(frame, cls, gps, 'x', null).rx_pubkey).toBe('')
  })
})

describe('shouldCapture', () => {
  const good = { lat: 51, lon: 4, acc_m: 8 }

  it('captures a reception with an identified sender', () => {
    expect(shouldCapture({ isDirect: true }, good)).toBe(true)
  })

  // #454: attribution is not a condition. A reception nobody can be named for
  // is still an RSSI, an SNR and a position our own radio produced, and that is
  // the half that cannot be forged.
  it('captures one with no identified sender just the same', () => {
    expect(shouldCapture({ isDirect: false }, good)).toBe(true)
  })

  // The hex grid has no way to un-see a reception once it is binned, so a fix
  // too poor to be meaningful is refused at the source rather than recorded
  // and sorted out downstream (#274). This is the only refusal left.
  it('refuses any reception when the fix is too inaccurate', () => {
    expect(shouldCapture({ isDirect: true }, { lat: 51, lon: 4, acc_m: 350 })).toBe(false)
    expect(shouldCapture({ isDirect: false }, { lat: 51, lon: 4, acc_m: 350 })).toBe(false)
  })

  it('refuses when there is no fix or the fix is invalid', () => {
    expect(shouldCapture({ isDirect: true }, null)).toBe(false)
    expect(shouldCapture({ isDirect: true }, { lat: NaN, lon: 4, acc_m: 8 })).toBe(false)
  })

  it('refuses a missing classification', () => {
    expect(shouldCapture(null, good)).toBe(false)
  })
})

// The kinds the app can hear and never attribute, driven through the real
// classifier rather than a hand-made isDirect: false (classify.test.js pins
// that they come out unattributed; this pins what then happens to them). The
// packet type has to survive into the record, because that is the only handle
// the filter chips have on a reception with no sender.
describe('unattributable receptions end to end (#454)', () => {
  const good = { lat: 51, lon: 4, acc_m: 8 }
  const frame = { snr: -8.5, rssi: -104, raw: new Uint8Array([0x01, 0x02]) }
  const cases = [
    ['TRACE', { payloadType: 9, pathLength: 3, routeType: 1, path: ['AABB', 'CCDD', 'EEFF'], payload: { decoded: {} } }],
    ['a DIRECT-route relay', { payloadType: 0, pathLength: 2, routeType: 2, path: ['AABB', 'CCDD'], payload: { decoded: {} } }],
  ]

  for (const [name, decoded] of cases) {
    it(`captures ${name}`, () => {
      expect(shouldCapture(classifyReception(decoded), good)).toBe(true)
    })

    it(`records ${name} with a packet type and no sender`, () => {
      const rec = buildRecord(frame, classifyReception(decoded), good, '2026-08-22T10:00:00Z')
      expect(rec.packet_type).toBeTruthy()
      expect(rec.sender_kind).toBeNull()
      expect(rec.sender_id).toBeNull()
      expect(rec.sender_label).toBeNull()
      expect(rec.is_direct).toBe(false)
      expect(rec.rssi).toBe(-104)
      expect(rec.lat).toBe(51)
    })
  }

  // A 1-byte FLOOD hash was in the list above until 2026-08-25. It is not
  // unattributable any more: it is named, weakly, and the record has to carry
  // the byte all the way through buildRecord or the surfaces still print '—'.
  it('records a 1-byte FLOOD hash with the byte as its sender', () => {
    const decoded = { payloadType: 0, pathLength: 1, routeType: 1, path: ['AB'], payload: { decoded: {} } }
    const rec = buildRecord(frame, classifyReception(decoded), good, '2026-08-22T10:00:00Z')
    expect(rec.sender_kind).toBe('path_hash')
    expect(rec.sender_id).toBe('ab')
    expect(rec.sender_label).toBe('ab')
    expect(rec.is_direct).toBe(true)
  })
})
