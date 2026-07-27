import { describe, it, expect, vi } from 'vitest'
import mqtt from 'mqtt'
import { Publisher, KEEPALIVE_S } from '../publisher.js'

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => ({ once: () => {}, connected: false })) },
}))

describe('Publisher.connect', () => {
  // #230: the broker dropping the connection was one of three symptoms of main-
  // thread saturation. An explicit keepalive does not prevent that, but it makes
  // the timeout deliberate and documented rather than mqtt.js's 60 s default.
  it('sets an explicit keepalive', () => {
    new Publisher({ url: 'wss://x', username: 'u', password: 'p' }).connect()
    expect(mqtt.connect).toHaveBeenCalledWith('wss://x', expect.objectContaining({
      keepalive: KEEPALIVE_S,
    }))
  })

  it('keeps the keepalive well under the broker default so a drop is detected sooner', () => {
    expect(KEEPALIVE_S).toBeLessThan(60)
  })
})

describe('Publisher.buildPayload', () => {
  it('includes new sender fields, drops legacy ones', () => {
    const rec = { rx_at: 't', raw: 'dead', snr: -3.5, rssi: -92, lat: 51, lon: 4, acc_m: 8,
      sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a', channel_name: null,
      is_direct: true, hops: 0, packet_type: 'Response' }
    const p = Publisher.buildPayload('aabb', rec, 'hunter-1')
    expect(p).toMatchObject({
      origin_id: 'aabb', origin: 'hunter-1', timestamp: 't', type: 'PACKET', direction: 'rx',
      raw: 'dead', SNR: -3.5, RSSI: -92, is_direct: true, hops: 0, packet_type: 'Response',
      sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a', channel_name: null,
      gps: { lat: 51, lon: 4, acc_m: 8 },
    })
    expect('sender_key' in p).toBe(false)
    expect('text' in p).toBe(false)
  })
})
