import { describe, it, expect } from 'vitest'
import { buildRecord, shouldCapture } from '../capture.js'

describe('buildRecord', () => {
  it('flattens frame + classification + gps; no decrypted text', () => {
    const frame = { snr: -3.5, rssi: -92, raw: new Uint8Array([0xde, 0xad]) }
    const cls = { packetType: 'GroupText', hops: 0, isDirect: true,
      sender: { kind: 'channel_name', id: 'Spammer', label: 'Spammer' }, channel: 'public', text: 'buy now' }
    const rec = buildRecord(frame, cls, { lat: 51, lon: 4, acc_m: 8 }, '2026-06-29T10:00:00Z')
    expect(rec).toEqual({
      rx_at: '2026-06-29T10:00:00Z', raw: 'dead', snr: -3.5, rssi: -92, lat: 51, lon: 4, acc_m: 8,
      sender_kind: 'channel_name', sender_id: 'Spammer', sender_label: 'Spammer', sender_role: null, channel_name: 'public',
      is_direct: true, hops: 0, packet_type: 'GroupText',
    })
    expect('text' in rec).toBe(false)
  })
})

describe('shouldCapture', () => {
  const good = { lat: 51, lon: 4, acc_m: 8 }

  it('returns true for a direct (zero-hop) classification with a usable fix', () => {
    expect(shouldCapture({ isDirect: true }, good)).toBe(true)
  })

  it('returns false for a relayed (non-zero-hop) classification', () => {
    expect(shouldCapture({ isDirect: false }, good)).toBe(false)
  })

  // The hex grid has no way to un-see a reception once it is binned, so a fix
  // too poor to be meaningful is refused at the source rather than recorded
  // and sorted out downstream (#274).
  it('refuses a direct reception when the fix is too inaccurate', () => {
    expect(shouldCapture({ isDirect: true }, { lat: 51, lon: 4, acc_m: 350 })).toBe(false)
  })

  it('refuses a direct reception when there is no fix or the fix is invalid', () => {
    expect(shouldCapture({ isDirect: true }, null)).toBe(false)
    expect(shouldCapture({ isDirect: true }, { lat: NaN, lon: 4, acc_m: 8 })).toBe(false)
  })
})
