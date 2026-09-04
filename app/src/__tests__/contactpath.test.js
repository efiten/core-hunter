import { describe, it, expect } from 'vitest'
import {
  buildGetContactByKey, parseContactReply, needsPathOverride, buildOverrideFrame, buildRestoreFrame,
  encodePendingRestore, decodePendingRestore,
  CMD_GET_CONTACT_BY_KEY, CMD_ADD_UPDATE_CONTACT, RESP_CODE_CONTACT, RESP_CODE_ERR, ERR_CODE_NOT_FOUND, CONTACT_FRAME_LEN,
} from '../contactpath.js'

const PK = 'ab'.repeat(32)

// A RESP_CODE_CONTACT frame as writeContactRespFrame lays it out
// (examples/companion_radio/MyMesh.cpp:166-187), every field a distinct
// non-zero pattern so a byte diff tells touched from untouched.
function contactFrame(outPathLen) {
  const b = new Uint8Array(CONTACT_FRAME_LEN)
  b[0] = RESP_CODE_CONTACT
  for (let i = 0; i < 32; i++) b[1 + i] = 0xab
  b[33] = 1  // type: ADV_TYPE_CHAT
  b[34] = 1  // flags
  b[35] = outPathLen
  for (let i = 0; i < 64; i++) b[36 + i] = 0x11 + (i % 7)
  const name = 'companion-under-test'
  for (let i = 0; i < name.length; i++) b[100 + i] = name.charCodeAt(i)
  const v = new DataView(b.buffer)
  v.setUint32(132, 1755518096, true)
  v.setInt32(136, 512345678, true)
  v.setInt32(140, 41234567, true)
  v.setUint32(144, 1755518200, true)
  return b
}

const diffs = (a, b) => { const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i); return d }

describe('buildGetContactByKey', () => {
  it('is [30][pubkey 32]', () => {
    const f = buildGetContactByKey(PK.toUpperCase())
    expect(f.length).toBe(33)
    expect(f[0]).toBe(CMD_GET_CONTACT_BY_KEY)
    expect([...f.slice(1)]).toEqual(new Array(32).fill(0xab))
  })
  it('refuses anything but a full 64-hex pubkey', () => {
    expect(() => buildGetContactByKey('zz'.repeat(32))).toThrow(TypeError)
    expect(() => buildGetContactByKey('ab'.repeat(31))).toThrow(TypeError)
  })
})

describe('parseContactReply', () => {
  it('reads a found contact, its out_path_len and the raw frame to echo back', () => {
    const frame = contactFrame(5)
    const c = parseContactReply(frame)
    expect(c.found).toBe(true)
    expect(c.outPathLen).toBe(5)
    expect(c.pubkey).toBe(PK)
    expect([...c.raw]).toEqual([...frame])
  })
  it('reads ERR_CODE_NOT_FOUND as not a contact', () => {
    expect(parseContactReply(new Uint8Array([RESP_CODE_ERR, ERR_CODE_NOT_FOUND]))).toEqual({ found: false })
  })
  // Half a frame echoed back would rewrite the contact with garbage, so a short
  // one is rejected outright rather than parsed as far as it goes.
  it('rejects a truncated contact frame, a foreign error, a wrong code and nothing at all', () => {
    expect(parseContactReply(contactFrame(5).slice(0, CONTACT_FRAME_LEN - 1))).toBeNull()
    expect(parseContactReply(new Uint8Array([RESP_CODE_ERR, 9]))).toBeNull()
    expect(parseContactReply(new Uint8Array([0x8c, 0, 0, 0]))).toBeNull()
    expect(parseContactReply(new Uint8Array([]))).toBeNull()
    expect(parseContactReply(null)).toBeNull()
  })
})

describe('needsPathOverride', () => {
  it('is true for a stored path and for OUT_PATH_UNKNOWN, since both would not send zero-hop', () => {
    expect(needsPathOverride(parseContactReply(contactFrame(3)))).toBe(true)
    expect(needsPathOverride(parseContactReply(contactFrame(0xff)))).toBe(true)
  })
  it('is false for a contact already at zero hop, one not found, or a rejected parse', () => {
    expect(needsPathOverride(parseContactReply(contactFrame(0)))).toBe(false)
    expect(needsPathOverride(parseContactReply(new Uint8Array([RESP_CODE_ERR, ERR_CODE_NOT_FOUND])))).toBe(false)
    expect(needsPathOverride(null)).toBe(false)
  })
})

describe('buildOverrideFrame / buildRestoreFrame', () => {
  // updateContactFromFrame (MyMesh.cpp:189-212) reads the same layout back, so
  // the reply becomes the command by rewriting byte 0, and the override by
  // rewriting byte 35 as well. Every other byte, last_mod included, is echoed:
  // the firmware falls back to "now" for a missing last_mod.
  it('override differs from the original in exactly byte 0 and byte 35', () => {
    for (const orig of [contactFrame(7), contactFrame(0xff)]) {
      const o = buildOverrideFrame(orig)
      expect(diffs(orig, o)).toEqual([0, 35])
      expect(o[0]).toBe(CMD_ADD_UPDATE_CONTACT)
      expect(o[35]).toBe(0)
    }
  })
  it('restore differs in byte 0 only, and puts the original out_path_len back', () => {
    const orig = contactFrame(7)
    const r = buildRestoreFrame(orig)
    expect(diffs(orig, r)).toEqual([0])
    expect(r[35]).toBe(7)
    expect(new DataView(r.buffer).getUint32(144, true)).toBe(new DataView(orig.buffer).getUint32(144, true))
  })
})

// The record app.js keeps while a contact is held zero-hop, so a session that
// dies between the override and the restore can put the contact back on the
// next connect to the same companion.
describe('encodePendingRestore / decodePendingRestore', () => {
  it('round-trips, lowercasing both keys', () => {
    const raw = contactFrame(9)
    const rec = decodePendingRestore(encodePendingRestore('EE'.repeat(32), PK.toUpperCase(), raw))
    expect(rec.self).toBe('ee'.repeat(32))
    expect(rec.target).toBe(PK)
    expect([...rec.raw]).toEqual([...raw])
  })
  it('rejects malformed JSON, missing fields, a raw frame of the wrong length and a non-object', () => {
    expect(decodePendingRestore('not json')).toBeNull()
    expect(decodePendingRestore(JSON.stringify({ self: 'aa'.repeat(32) }))).toBeNull()
    expect(decodePendingRestore(JSON.stringify({ self: 'aa'.repeat(32), target: 'bb'.repeat(32), raw: 'ab'.repeat(10) }))).toBeNull()
    expect(decodePendingRestore('42')).toBeNull()
    expect(decodePendingRestore('null')).toBeNull()
  })
})
