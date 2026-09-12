import { describe, it, expect } from 'vitest'
import {
  buildTelemetryRequest, parseSentAck, parseTelemetryResponse, parseLpp,
  rememberAsk, matchTelemetryTarget, pruneAsks, nextTelemetryTarget,
  CMD_SEND_TELEMETRY_REQ, RESP_CODE_SENT, PUSH_CODE_TELEMETRY_RESPONSE, ASK_TTL_MS,
} from '../telemetryreq.js'

const PK = 'c3'.repeat(32)
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]

describe('buildTelemetryRequest', () => {
  // CMD_SEND_TELEMETRY_REQ needs len >= 4 + 32 and reads the pubkey at byte 4
  // (examples/companion_radio/MyMesh.cpp, the lookupContactByPubKey branch);
  // bytes 1-3 are not read, so they are 0.
  it('is [39][0 0 0][pubkey 32]', () => {
    const f = buildTelemetryRequest(PK.toUpperCase())
    expect(f.length).toBe(36)
    expect(f[0]).toBe(CMD_SEND_TELEMETRY_REQ)
    expect([...f.slice(1, 4)]).toEqual([0, 0, 0])
    expect([...f.slice(4)]).toEqual(new Array(32).fill(0xc3))
  })
  it('refuses anything but a full 64-hex pubkey, since the firmware looks the contact up by all 32 bytes', () => {
    expect(() => buildTelemetryRequest('c3'.repeat(31))).toThrow(TypeError)
    expect(() => buildTelemetryRequest('zz'.repeat(32))).toThrow(TypeError)
  })
})

describe('parseSentAck', () => {
  // RESP_CODE_SENT: [6][1 = flood, 0 = direct][tag 4][est_timeout 4]
  it('reads the route and the tag', () => {
    expect(parseSentAck(new Uint8Array([RESP_CODE_SENT, 0, ...le32(0x11223344), ...le32(9000)]))).toEqual({ tag: 0x11223344, isFlood: false, estTimeoutMs: 9000 })
    expect(parseSentAck(new Uint8Array([RESP_CODE_SENT, 1, ...le32(1), ...le32(2)])).isFlood).toBe(true)
  })
  it('rejects a wrong code and a short frame', () => {
    expect(parseSentAck(new Uint8Array([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(parseSentAck(new Uint8Array([RESP_CODE_SENT, 0, 1, 2]))).toBeNull()
  })
})

describe('parseLpp', () => {
  // CayenneLPP as the firmware fills it (electroniccats/CayenneLPP 1.6.1,
  // helpers/sensors/LPPDataHelpers.h): [channel][type][data], voltage type
  // 116 in 0.01 V unsigned big-endian, temperature type 103 in 0.1 °C signed.
  it('reads the voltage and the temperature the companion adds', () => {
    const t = parseLpp(new Uint8Array([1, 116, 0x01, 0x8d, 1, 103, 0x00, 0xfa]))
    expect(t.voltage_v).toBeCloseTo(3.97, 5)
    expect(t.temp_c).toBeCloseTo(25.0, 5)
  })
  it('reads a temperature below zero as signed', () => {
    expect(parseLpp(new Uint8Array([1, 103, 0xff, 0xce])).temp_c).toBeCloseTo(-5.0, 5)
  })
  // A board with extra sensors adds fields the app does not read; a known
  // size lets them be skipped, an unknown type ends the walk without guessing.
  it('skips a known field it does not use and stops at an unknown type', () => {
    const t = parseLpp(new Uint8Array([2, 104, 0x64, 1, 116, 0x01, 0x8d, 9, 250, 1, 2, 3, 1, 103, 0x00, 0xfa]))
    expect(t.voltage_v).toBeCloseTo(3.97, 5)
    expect(t.temp_c).toBeUndefined()
  })
  it('is empty for nothing, and never throws on a truncated field', () => {
    expect(parseLpp(new Uint8Array([]))).toEqual({})
    expect(parseLpp(new Uint8Array([1, 116, 0x01]))).toEqual({})
  })
})

describe('parseTelemetryResponse', () => {
  // PUSH_CODE_TELEMETRY_RESPONSE: [0x8B][0][pubkey prefix 6][lpp...]
  // (examples/companion_radio/MyMesh.cpp, onContactResponse's pending_telemetry branch)
  it('reads the responder prefix and its telemetry', () => {
    const r = parseTelemetryResponse(new Uint8Array([PUSH_CODE_TELEMETRY_RESPONSE, 0, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 1, 116, 0x01, 0x8d]))
    expect(r.prefix).toBe('c3c3c3c3c3c3')
    expect(r.telemetry.voltage_v).toBeCloseTo(3.97, 5)
  })
  it('rejects a wrong code and a frame too short for the prefix', () => {
    expect(parseTelemetryResponse(new Uint8Array([0x8c, 0, 1, 2, 3, 4, 5, 6]))).toBeNull()
    expect(parseTelemetryResponse(new Uint8Array([PUSH_CODE_TELEMETRY_RESPONSE, 0, 1, 2]))).toBeNull()
  })
})

// The reply is a RESPONSE datagram carrying only the 1-byte source hash, so
// like a trace reply (#481) it is attributed to the node we asked, and only
// while one ask is live for that byte: two live asks sharing a first byte are
// refused rather than guessed.
describe('rememberAsk / matchTelemetryTarget / pruneAsks', () => {
  const OTHER = 'c3' + 'aa'.repeat(31)
  const FAR = '5f'.repeat(32)
  it('matches the reply hash to the one live ask that starts with it', () => {
    const asks = rememberAsk([], PK, 1000)
    expect(matchTelemetryTarget(asks, 'C3', 2000)).toBe(PK)
    expect(matchTelemetryTarget(asks, '5f', 2000)).toBeNull()
  })
  it('refuses a hash two live asks share', () => {
    const asks = rememberAsk(rememberAsk([], PK, 1000), OTHER, 1500)
    expect(matchTelemetryTarget(asks, 'c3', 2000)).toBeNull()
    expect(matchTelemetryTarget(rememberAsk(asks, FAR, 1600), '5f', 2000)).toBe(FAR)
  })
  it('forgets an ask once its TTL has passed', () => {
    const asks = rememberAsk([], PK, 1000)
    expect(matchTelemetryTarget(asks, 'c3', 1000 + ASK_TTL_MS + 1)).toBeNull()
    expect(pruneAsks(asks, 1000 + ASK_TTL_MS + 1)).toEqual([])
    expect(pruneAsks(asks, 1000 + ASK_TTL_MS - 1)).toHaveLength(1)
  })
  it('ignores a malformed hash or pubkey', () => {
    expect(rememberAsk([], 'nope', 1000)).toEqual([])
    expect(matchTelemetryTarget(rememberAsk([], PK, 1000), '', 2000)).toBeNull()
  })
})

// One ask per cycle, rotating over the selected companions: the firmware
// keeps one pending telemetry tag, so a second ask in flight would orphan the
// first reply.
describe('nextTelemetryTarget', () => {
  it('walks the list one per call and wraps', () => {
    const ids = ['a', 'b', 'c']
    expect(nextTelemetryTarget(ids, 0)).toEqual({ id: 'a', cursor: 1 })
    expect(nextTelemetryTarget(ids, 1)).toEqual({ id: 'b', cursor: 2 })
    expect(nextTelemetryTarget(ids, 2)).toEqual({ id: 'c', cursor: 3 })
    expect(nextTelemetryTarget(ids, 3)).toEqual({ id: 'a', cursor: 4 })
  })
  it('lands inside a list that shrank, and is null for an empty one', () => {
    expect(nextTelemetryTarget(['a', 'b'], 7)).toEqual({ id: 'b', cursor: 8 })
    expect(nextTelemetryTarget([], 3)).toBeNull()
  })
})
