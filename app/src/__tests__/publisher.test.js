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

describe('Publisher.publish — a broker that never answers (#554)', () => {
  // A broker that accepts the connection but drops the message sends no PUBACK,
  // and mqtt.js then never calls back. With several brokers that would hold the
  // drain, and every other broker with it, for ever.
  it('gives up on a publish the broker never acknowledges', async () => {
    const p = new Publisher({ url: 'wss://x.example', ackTimeoutMs: 20 })
    p.client = { publish() { /* never calls back */ } }
    await expect(p.publish('ab'.repeat(32), { raw: '1500' })).rejects.toThrow(/not acknowledged/)
  })

  it('still resolves on an acknowledgement that arrives in time', async () => {
    const p = new Publisher({ url: 'wss://x.example', ackTimeoutMs: 50 })
    p.client = { publish(_t, _p, _o, cb) { setTimeout(() => cb(null), 5) } }
    await expect(p.publish('ab'.repeat(32), { raw: '1500' })).resolves.toBeUndefined()
  })
})

describe('Publisher — the wardrive format (#554)', () => {
  const REC = { rx_at: '2026-09-21T10:00:00.000Z', rx_pubkey: 'ab'.repeat(32), raw: '15008bdead', snr: 5, rssi: -90, lat: 52.1, lon: 5.1, acc_m: 8 }
  const capture = () => { const sent = []; return { sent, client: { publish(topic, payload, opts, cb) { sent.push({ topic, payload: JSON.parse(payload), opts }); cb(null) } } } }

  it('publishes a reception as an obs on the wardriver topic of its label', async () => {
    const c = capture()
    const p = new Publisher({ url: 'wss://x.example', format: 'wardrive', label: 'hunter' })
    p.client = c.client
    await p.publish('', REC, 'Kas')
    expect(c.sent).toHaveLength(1)
    expect(c.sent[0].topic).toBe('meshcore/hunter/' + 'AB'.repeat(32) + '/wardriver/obs')
    expect(c.sent[0].payload).toMatchObject({ v: 1, origin_id: 'AB'.repeat(32), hash: 'a8dd682eb57e5992', pos: { lat: 52.1, lon: 5.1, accuracy: 8, src: 'phone' } })
    // The companion's name is not part of this format.
    expect(JSON.stringify(c.sent[0].payload)).not.toContain('Kas')
  })

  it('keeps the packets format for a broker that does not ask for anything else', async () => {
    const c = capture()
    const p = new Publisher({ url: 'wss://x.example' })
    p.client = c.client
    await p.publish('', REC, 'Kas')
    expect(c.sent[0].topic).toBe('meshcore/hunter/' + 'ab'.repeat(32) + '/packets')
    expect(c.sent[0].payload.type).toBe('PACKET')
  })

  // Without the hash a consumer cannot join the reception to anything, and
  // failing instead would block the queue behind it.
  it('passes over a reception whose frame cannot be hashed, without sending it', async () => {
    const c = capture()
    const p = new Publisher({ url: 'wss://x.example', format: 'wardrive' })
    p.client = c.client
    await expect(p.publish('', { ...REC, raw: '15' })).resolves.toBeUndefined()
    expect(c.sent).toEqual([])
  })

  it('publishes a track on the track topic of the companion it belongs to', async () => {
    const c = capture()
    const p = new Publisher({ url: 'wss://x.example', format: 'wardrive', label: 'hunter' })
    p.client = c.client
    await p.publishTrack({ rx_pubkey: 'cd'.repeat(32), t0: 'a', t1: 'b', lat: 52.1, lon: 5.1, acc_m: 9, rx_count: 0, listening: true })
    expect(c.sent[0].topic).toBe('meshcore/hunter/' + 'CD'.repeat(32) + '/wardriver/track')
    expect(c.sent[0].payload).toEqual({ v: 1, origin_id: 'CD'.repeat(32), t0: 'a', t1: 'b', lat: 52.1, lon: 5.1, accuracy: 9, rx_count: 0, listening: true, src: 'phone' })
  })
})
