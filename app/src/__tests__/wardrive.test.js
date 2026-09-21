import { describe, it, expect } from 'vitest'
import { frameWalk, packetHash, buildObs, buildTrack, shouldEmitTrack, obsTopic, trackTopic, TRACK_INTERVAL_S, TRACK_DISTANCE_M, createTrackWindow } from '../wardrive.js'

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')

// Reference hashes from the DutchMeshCore ingest, which validated its own
// implementation against firmware Packet::calculatePacketHash and live observer
// hashes. They are the values a consumer deduplicates on, so ours must match.
const VECTORS = [
  { raw: [0x15, 0x00, 0x8b, 0xde, 0xad], hash: 'a8dd682eb57e5992' },
  { raw: [0x11, 0x02, 0x7f, 0x33, ...new Array(32).fill(0)], hash: 'f09cc66424a35e60' },
  { raw: [0x09, 0x00, 0x01, 0x02, 0x03, 0x04], hash: '7b3fa4f005ec9fc3' },
]

// None of the three above is a TRACE (header 0x09 is payload type 2), and a
// TRACE is the one type that hashes differently: Packet::calculatePacketHash
// feeds path_len in as a uint16 before the payload. Header 0x25 is TRACE on a
// flood route; the expected value is SHA-256 over 09 02 00 01 02, worked out
// with node:crypto rather than with the code under test.
const TRACE = { raw: [0x25, 0x02, 0xaa, 0xbb, 0x01, 0x02], hash: '508606e568249d06' }

describe('packetHash: the packet identity consumers deduplicate on (#554)', () => {
  it.each(VECTORS)('matches the reference for $hash', async (v) => {
    expect(await packetHash(hex(v.raw))).toBe(v.hash)
  })

  it('adds path_len to the hash of a TRACE, as the firmware does', async () => {
    expect(await packetHash(hex(TRACE.raw))).toBe(TRACE.hash)
  })

  it('does not change with the path a packet took', async () => {
    const direct = [0x15, 0x00, 0x8b, 0xde, 0xad]
    const relayed = [0x15, 0x02, 0xaa, 0xbb, 0x8b, 0xde, 0xad]
    expect(await packetHash(hex(relayed))).toBe(await packetHash(hex(direct)))
  })

  it('returns null for a frame it cannot walk', async () => {
    expect(await packetHash('')).toBeNull()
    expect(await packetHash('15')).toBeNull()
    expect(await packetHash(hex([0x15, 0x02, 0xaa, 0xbb]))).toBeNull() // no payload left
    expect(await packetHash(hex([0x15, 0xc1, 0, 0, 0, 0, 0x01]))).toBeNull() // hash size 4 is not valid
  })
})

describe('frameWalk: header, transport codes, path (#554)', () => {
  it('skips the four transport-code bytes on a transport route', () => {
    const w = frameWalk(new Uint8Array([0x14, 1, 2, 3, 4, 0x01, 0xaa, 0xbb]))
    expect(w).toMatchObject({ routeType: 0, payloadType: 5, hops: ['aa'], payloadStart: 7 })
  })

  it('splits the path by its hash size', () => {
    const w = frameWalk(new Uint8Array([0x15, 0x42, 0xaa, 0xbb, 0xcc, 0xdd, 0x01]))
    expect(w.hops).toEqual(['aabb', 'ccdd'])
  })
})

const REC = { rx_at: '2026-09-21T10:00:00.000Z', rx_pubkey: 'ab'.repeat(32), raw: hex([0x15, 0x01, 0xaa, 0x8b, 0xde, 0xad]), snr: -3.5, rssi: -92, lat: 52.123456789, lon: 5.987654321, acc_m: 8.04 }

describe('buildObs: one reception in the wardrive shape (#554)', () => {
  it('carries the reception, its position and the packet identity', async () => {
    expect(await buildObs(REC, { originId: 'AB'.repeat(32), pubAt: '2026-09-21T10:00:05.000Z' })).toEqual({
      v: 1,
      origin_id: 'AB'.repeat(32),
      rx_at: '2026-09-21T10:00:00.000Z',
      pub_at: '2026-09-21T10:00:05.000Z',
      hash: 'a8dd682eb57e5992',
      raw: '1501aa8bdead',
      len: 6,
      packet_type: 5,
      route: 'F',
      payload_len: 3,
      path: ['aa'],
      RSSI: -92,
      SNR: -3.5,
      pos: { lat: 52.123457, lon: 5.987654, accuracy: 8, src: 'phone' },
    })
  })

  it('marks a direct route, and leaves the route out when it is neither', async () => {
    expect((await buildObs({ ...REC, raw: hex([0x16, 0x00, 0x8b]) }, { originId: 'x' })).route).toBe('D')
  })

  it('leaves accuracy out when the phone gave none, rather than sending 0', async () => {
    const obs = await buildObs({ ...REC, acc_m: null }, { originId: 'x' })
    expect('accuracy' in obs.pos).toBe(false)
  })

  it('returns null for a reception whose frame cannot be hashed', async () => {
    expect(await buildObs({ ...REC, raw: '15' }, { originId: 'x' })).toBeNull()
  })
})

describe('buildTrack: a listening interval (#554)', () => {
  it('says where the phone was, for how long, and what it heard', () => {
    expect(buildTrack({ originId: 'K', t0: '2026-09-21T10:00:00.000Z', t1: '2026-09-21T10:00:10.000Z', lat: 52.1234567, lon: 5.1, accM: 12.34, rxCount: 3, listening: true })).toEqual({
      v: 1, origin_id: 'K', t0: '2026-09-21T10:00:00.000Z', t1: '2026-09-21T10:00:10.000Z',
      lat: 52.123457, lon: 5.1, accuracy: 12.3, rx_count: 3, listening: true, src: 'phone',
    })
  })

  // Silence is evidence: rx_count 0 while listening tells a triangulator the
  // transmitter was NOT heard here. A dropped radio must never claim that.
  it('only claims to have been listening when told so explicitly', () => {
    const base = { originId: 'K', t0: 'a', t1: 'b', lat: 1, lon: 2, rxCount: 0 }
    expect(buildTrack({ ...base, listening: true }).listening).toBe(true)
    expect(buildTrack({ ...base, listening: undefined }).listening).toBe(false)
    expect(buildTrack({ ...base, listening: 'yes' }).listening).toBe(false)
  })
})

describe('shouldEmitTrack: every 10 s or 25 m, whichever comes first (#554)', () => {
  const here = { lat: 52.0, lon: 5.0 }
  it('emits the first track of a session at once', () => {
    expect(shouldEmitTrack({ nowMs: 0, lastMs: null, lastPos: null, curPos: here })).toBe(true)
  })

  it('emits once the interval has passed', () => {
    expect(shouldEmitTrack({ nowMs: TRACK_INTERVAL_S * 1000, lastMs: 0, lastPos: here, curPos: here })).toBe(true)
    expect(shouldEmitTrack({ nowMs: TRACK_INTERVAL_S * 1000 - 1, lastMs: 0, lastPos: here, curPos: here })).toBe(false)
  })

  it('emits early once the phone has moved far enough', () => {
    const moved = { lat: 52.0 + (TRACK_DISTANCE_M + 5) / 111_320, lon: 5.0 }
    const barely = { lat: 52.0 + (TRACK_DISTANCE_M - 5) / 111_320, lon: 5.0 }
    expect(shouldEmitTrack({ nowMs: 1000, lastMs: 0, lastPos: here, curPos: moved })).toBe(true)
    expect(shouldEmitTrack({ nowMs: 1000, lastMs: 0, lastPos: here, curPos: barely })).toBe(false)
  })
})

describe('topics (#554)', () => {
  it('puts the stream label where a fixed observer has its region, and upper-cases the key', () => {
    expect(obsTopic('hunter', 'ab'.repeat(32))).toBe('meshcore/hunter/' + 'AB'.repeat(32) + '/wardriver/obs')
    expect(trackTopic('hunter', 'ab'.repeat(32))).toBe('meshcore/hunter/' + 'AB'.repeat(32) + '/wardriver/track')
  })
})

describe('createTrackWindow: counting what was heard between tracks (#554)', () => {
  const fix = { lat: 52.0, lon: 5.0, acc_m: 8 }
  const T0 = Date.parse('2026-09-21T10:00:00.000Z')
  const KEY = 'ab'.repeat(32)

  it('opens with a track at once, then one per interval carrying the count', () => {
    const w = createTrackWindow()
    const first = w.tick({ nowMs: T0, fix, rxPubkey: KEY })
    expect(first).toMatchObject({ t0: '2026-09-21T10:00:00.000Z', t1: '2026-09-21T10:00:00.000Z', rx_count: 0, listening: true, rx_pubkey: KEY })
    w.heard(); w.heard(); w.heard()
    expect(w.tick({ nowMs: T0 + 4000, fix, rxPubkey: KEY })).toBeNull()
    const second = w.tick({ nowMs: T0 + TRACK_INTERVAL_S * 1000, fix, rxPubkey: KEY })
    expect(second).toMatchObject({ t0: '2026-09-21T10:00:00.000Z', t1: '2026-09-21T10:00:10.000Z', rx_count: 3, lat: 52.0, lon: 5.0, acc_m: 8 })
    // The count starts over with each track.
    expect(w.tick({ nowMs: T0 + 2 * TRACK_INTERVAL_S * 1000, fix, rxPubkey: KEY }).rx_count).toBe(0)
  })

  // A track without a position cannot be placed, and silence that cannot be
  // placed is worth nothing. The count is kept for the track that can.
  it('waits for a fix, and keeps counting meanwhile', () => {
    const w = createTrackWindow()
    w.tick({ nowMs: T0, fix, rxPubkey: KEY })
    w.heard()
    expect(w.tick({ nowMs: T0 + 20_000, fix: null, rxPubkey: KEY })).toBeNull()
    w.heard()
    expect(w.tick({ nowMs: T0 + 30_000, fix, rxPubkey: KEY }).rx_count).toBe(2)
  })

  it('closes with a last track that says the phone stopped listening', () => {
    const w = createTrackWindow()
    w.tick({ nowMs: T0, fix, rxPubkey: KEY })
    w.heard()
    expect(w.close({ nowMs: T0 + 3000, fix, rxPubkey: KEY })).toMatchObject({ t1: '2026-09-21T10:00:03.000Z', rx_count: 1, listening: false })
  })

  it('has nothing to close when it never opened', () => {
    expect(createTrackWindow().close({ nowMs: T0, fix, rxPubkey: KEY })).toBeNull()
  })

  it('opens afresh after a close, without carrying the old interval over', () => {
    const w = createTrackWindow()
    w.tick({ nowMs: T0, fix, rxPubkey: KEY })
    w.close({ nowMs: T0 + 3000, fix, rxPubkey: KEY })
    expect(w.tick({ nowMs: T0 + 60_000, fix, rxPubkey: KEY })).toMatchObject({ t0: '2026-09-21T10:01:00.000Z', rx_count: 0 })
  })
})
