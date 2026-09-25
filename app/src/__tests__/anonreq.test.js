import { describe, it, expect } from 'vitest'
import {
  buildAnonRequest, parseBinaryResponse, readRegionsReply, readOwnerReply, nextAnonAsk, directedAskKind,
  CMD_SEND_ANON_REQ, ANON_REQ_TYPE_REGIONS, ANON_REQ_TYPE_OWNER, PUSH_CODE_BINARY_RESPONSE, TRUNCATION_WARN_BYTES, ANON_MIN_GAP_MS,
} from '../anonreq.js'

const PK = 'ab'.repeat(32)
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const ascii = (s) => [...new TextEncoder().encode(s)]
// A 0x8C push as the companion writes it (companion_radio/MyMesh.cpp,
// onContactResponse, pending_req branch): [0x8C][0][tag 4][data after the
// responder's 4-byte timestamp echo]. The repeater's reply data is
// [sender_timestamp 4][now 4][...] (simple_repeater/MyMesh.cpp), and the
// companion strips the first four, so what follows the tag here starts with
// the repeater's clock.
const push = (tag, clock, rest, pad = 0) => new Uint8Array([PUSH_CODE_BINARY_RESPONSE, 0, ...le32(tag), ...le32(clock), ...rest, ...new Array(pad).fill(0)])

describe('buildAnonRequest (#552)', () => {
  it('frames [57][pubkey 32][type][reply_path_len 0], a zero-hop reply', () => {
    const f = buildAnonRequest(PK, ANON_REQ_TYPE_REGIONS)
    expect(f.length).toBe(35)
    expect(f[0]).toBe(CMD_SEND_ANON_REQ)
    expect([...f.slice(1, 33)]).toEqual(new Array(32).fill(0xab))
    expect(f[33]).toBe(1)
    expect(f[34]).toBe(0)
    expect(buildAnonRequest(PK.toUpperCase(), ANON_REQ_TYPE_OWNER)[33]).toBe(2)
  })
  it('refuses anything but a full pubkey, and a type it does not know', () => {
    expect(() => buildAnonRequest('ab'.repeat(6), ANON_REQ_TYPE_REGIONS)).toThrow(TypeError)
    expect(() => buildAnonRequest(PK, 3)).toThrow(TypeError)
  })
})

describe('parseBinaryResponse', () => {
  it('reads the tag and hands back what follows it', () => {
    const r = parseBinaryResponse(push(0x01020304, 1790000000, ascii('be')))
    expect(r.tag).toBe(0x01020304)
    expect([...r.data]).toEqual([...le32(1790000000), ...ascii('be')])
  })
  it('refuses another push and a frame too short to carry a clock', () => {
    expect(parseBinaryResponse(new Uint8Array([0x8b, 0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(parseBinaryResponse(new Uint8Array([0x8c, 0, 1, 2, 3, 4, 5]))).toBeNull()
    expect(parseBinaryResponse(null)).toBeNull()
  })
})

describe('readRegionsReply', () => {
  const data = (bytes) => parseBinaryResponse(bytes).data
  it('reads the clock and the region list', () => {
    expect(readRegionsReply(data(push(1, 1790000000, ascii('be,nl,nl-gld'))))).toEqual({ repeaterClock: 1790000000, regions: ['be', 'nl', 'nl-gld'], truncated: false })
  })
  it('trims the block cipher padding, so it does not land in the last name', () => {
    expect(readRegionsReply(data(push(1, 5, ascii('belml'), 11))).regions).toEqual(['belml'])
  })
  it('reads an empty list as no regions', () => {
    expect(readRegionsReply(data(push(1, 5, [], 8))).regions).toEqual([])
  })
  it('flags a list at the floor where a dropped name can hide, measured in bytes', () => {
    const at = 'a'.repeat(TRUNCATION_WARN_BYTES)
    expect(readRegionsReply(data(push(1, 5, ascii(at)))).truncated).toBe(true)
    expect(readRegionsReply(data(push(1, 5, ascii(at.slice(1))))).truncated).toBe(false)
    expect(TRUNCATION_WARN_BYTES).toBe(139)
  })
})

describe('readOwnerReply', () => {
  const data = (bytes) => parseBinaryResponse(bytes).data
  it('reads the node name and the owner info, split on the first newline', () => {
    expect(readOwnerReply(data(push(1, 9, ascii('NL-NIJ-RPT\nKasper, 06 123'), 5)))).toEqual({ repeaterClock: 9, name: 'NL-NIJ-RPT', owner: 'Kasper, 06 123' })
  })
  it('keeps a newline inside the owner info, and reads an empty owner as empty', () => {
    expect(readOwnerReply(data(push(1, 9, ascii('R\nline one\nline two')))).owner).toBe('line one\nline two')
    expect(readOwnerReply(data(push(1, 9, ascii('R\n')))).owner).toBe('')
  })
})

// At most one anonymous ask per 60 s per target: the repeater's bucket refills
// at 4 per 180 s (simple_repeater/MyMesh.cpp anon_limiter(4, 180)), and an ask
// the bucket refuses is airtime spent for nothing.
describe('nextAnonAsk', () => {
  const now = 1_000_000
  it('asks for the regions first, then the owner, then the regions again', () => {
    expect(nextAnonAsk([PK], {}, now)).toEqual({ id: PK, type: ANON_REQ_TYPE_REGIONS })
    expect(nextAnonAsk([PK], { [PK]: { at: now - ANON_MIN_GAP_MS, type: ANON_REQ_TYPE_REGIONS } }, now)).toEqual({ id: PK, type: ANON_REQ_TYPE_OWNER })
    expect(nextAnonAsk([PK], { [PK]: { at: now - ANON_MIN_GAP_MS, type: ANON_REQ_TYPE_OWNER } }, now)).toEqual({ id: PK, type: ANON_REQ_TYPE_REGIONS })
  })
  it('asks no target twice within a minute', () => {
    expect(nextAnonAsk([PK], { [PK]: { at: now - ANON_MIN_GAP_MS + 1, type: ANON_REQ_TYPE_REGIONS } }, now)).toBeNull()
    expect(ANON_MIN_GAP_MS).toBe(60000)
  })
  it('picks the target asked longest ago, a never-asked one first', () => {
    const B = 'cd'.repeat(32), C = 'ef'.repeat(32)
    const last = { [PK]: { at: now - 90000, type: 1 }, [C]: { at: now - 70000, type: 1 } }
    expect(nextAnonAsk([PK, B, C], last, now).id).toBe(B)
    expect(nextAnonAsk([PK, C], last, now).id).toBe(PK)
  })
  it('leaves out an id that is not a full pubkey', () => {
    expect(nextAnonAsk(['ab', 'abcd'], {}, now)).toBeNull()
    expect(nextAnonAsk([], {}, now)).toBeNull()
  })
})

// One directed ask per cycle: the companion keeps one pending request tag and
// clears it on every send (clearPendingReqs), so a telemetry ask and an
// anonymous ask in one cycle would orphan whichever reply came second. When
// both are due they take turns.
describe('directedAskKind', () => {
  it('asks what is due, and takes turns when both are', () => {
    expect(directedAskKind({ telemetryDue: true, anonDue: false, last: 'telemetry' })).toBe('telemetry')
    expect(directedAskKind({ telemetryDue: false, anonDue: true, last: 'anon' })).toBe('anon')
    expect(directedAskKind({ telemetryDue: true, anonDue: true, last: 'telemetry' })).toBe('anon')
    expect(directedAskKind({ telemetryDue: true, anonDue: true, last: 'anon' })).toBe('telemetry')
    expect(directedAskKind({ telemetryDue: true, anonDue: true, last: null })).toBe('telemetry')
    expect(directedAskKind({ telemetryDue: false, anonDue: false, last: 'anon' })).toBeNull()
  })
})
