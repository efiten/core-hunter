import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildGetContactByKey, parseContactReply, needsPathOverride, buildOverrideFrame, buildRestoreFrame,
  encodePendingRestore, decodePendingRestore, askAtZeroHop, replayPendingRestores,
  CMD_GET_CONTACT_BY_KEY, CMD_ADD_UPDATE_CONTACT, RESP_CODE_CONTACT, RESP_CODE_ERR, ERR_CODE_NOT_FOUND, CONTACT_FRAME_LEN,
} from '../contactpath.js'

const PK = 'ab'.repeat(32)

// A RESP_CODE_CONTACT frame as writeContactRespFrame lays it out
// (examples/companion_radio/MyMesh.cpp:166-187), every field a distinct
// non-zero pattern so a byte diff tells touched from untouched.
function contactFrame(outPathLen, pkByte = 0xab) {
  const b = new Uint8Array(CONTACT_FRAME_LEN)
  b[0] = RESP_CODE_CONTACT
  for (let i = 0; i < 32; i++) b[1 + i] = pkByte
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

// The dance, against a companion that answers from a script: the contact read
// with `contacts[pubkey]` (a missing key is no reply at all), every write with
// `ack(frame)`. `log` keeps what reached the companion, in order, so a test
// asserts the whole sequence rather than an endpoint.
function fakeCompanion({ contacts = {}, ack = () => true } = {}) {
  const log = []
  const hex2 = (b) => b.toString(16).padStart(2, '0')
  return {
    log,
    io: {
      getContact: async (pk) => { log.push(`read ${pk.slice(0, 2)}`); return pk in contacts ? contacts[pk] : null },
      writeContact: async (frame) => {
        log.push(`${frame[35] === 0 ? 'override' : 'restore'} ${hex2(frame[1])}`)
        return ack(frame)
      },
    },
  }
}

// localStorage as the browser keeps it, in memory.
function memoryStorage() {
  const items = new Map()
  return {
    items,
    get length() { return items.size },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)) },
    removeItem: (k) => { items.delete(k) },
  }
}

const SELF = 'ee'.repeat(32)
const OTHER = 'ff'.repeat(32)
const A = 'ab'.repeat(32)
const B = 'cd'.repeat(32)
const found = (outPathLen, pkByte = 0xab) => parseContactReply(contactFrame(outPathLen, pkByte))
const restoreNeverAcks = (frame) => frame[35] === 0

describe('askAtZeroHop', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('holds a contact with a stored path at zero hop for the ask, then writes it back', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const c = fakeCompanion({ contacts: { [A]: found(7) } })
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab', 'override ab', 'ask', 'restore ab'])
    expect(r).toEqual({ asked: true, restored: true })
  })

  it('asks without writing anything when the contact is already zero-hop', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const c = fakeCompanion({ contacts: { [A]: found(0) } })
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab', 'ask'])
    expect(r).toEqual({ asked: true })
  })

  it('asks nothing and writes nothing for a node that is not a contact', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const c = fakeCompanion({ contacts: { [A]: { found: false } } })
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab'])
    expect(r.asked).toBe(false)
  })

  // A contact read with no answer says nothing about the stored route, and a
  // contact added from its advert starts with the unknown route the firmware
  // floods (BaseChatMesh.cpp populateContactFromAdvert, sendRequest).
  it('asks nothing when the contact read gets no answer', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const c = fakeCompanion()
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab'])
    expect(r.asked).toBe(false)
  })

  // Where storage throws (Safari with cookies blocked, a locked-down webview),
  // the record that brings the contact back after a dropped link cannot be
  // kept. An override then has no way back, so the contact is not touched.
  it('makes no override and asks nothing when the restore record cannot be stored', async () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new Error('SecurityError') }
    vi.stubGlobal('localStorage', storage)
    const c = fakeCompanion({ contacts: { [A]: found(7) } })
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab'])
    expect(r.asked).toBe(false)
  })

  // An override the companion refused leaves the contact as it was, so an ask
  // would flood; the restore still goes out, since the write may have landed.
  it('asks nothing when the override is refused, and still writes the original back', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const c = fakeCompanion({ contacts: { [A]: found(7) }, ack: (frame) => frame[35] !== 0 })
    const r = await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    expect(c.log).toEqual(['read ab', 'override ab', 'restore ab'])
    expect(r.asked).toBe(false)
    expect(r.restored).toBe(true)
  })
})

describe('the restore record', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('stays until a restore acks, and the next connect to that companion replays it', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const r = await askAtZeroHop(fakeCompanion({ contacts: { [A]: found(7) }, ack: restoreNeverAcks }).io, SELF, A, async () => {})
    expect(r.restored).toBe(false)
    expect(storage.items.size).toBe(1)

    const next = fakeCompanion()
    expect(await replayPendingRestores(next.io, SELF)).toBe(true)
    expect(next.log).toEqual(['restore ab'])
    expect(storage.items.size).toBe(0)
  })

  // A restore that did not ack is owed until the next connect. The asks after
  // it, to another contact or from another companion, must not overwrite it.
  it('keeps a restore owed to one contact when another contact is asked', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await askAtZeroHop(fakeCompanion({ contacts: { [A]: found(7) }, ack: restoreNeverAcks }).io, SELF, A, async () => {})
    const r = await askAtZeroHop(fakeCompanion({ contacts: { [B]: found(3, 0xcd) } }).io, SELF, B, async () => {})
    expect(r.restored).toBe(true)

    const next = fakeCompanion()
    expect(await replayPendingRestores(next.io, SELF)).toBe(true)
    expect(next.log).toEqual(['restore ab'])
    expect(storage.items.size).toBe(0)
  })

  it('keeps a restore owed to one companion when another companion asks', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await askAtZeroHop(fakeCompanion({ contacts: { [A]: found(7) }, ack: restoreNeverAcks }).io, SELF, A, async () => {})
    await askAtZeroHop(fakeCompanion({ contacts: { [B]: found(3, 0xcd) } }).io, OTHER, B, async () => {})

    const back = fakeCompanion()
    expect(await replayPendingRestores(back.io, SELF)).toBe(true)
    expect(back.log).toEqual(['restore ab'])
    expect(storage.items.size).toBe(0)
  })

  it('replays every restore owed to the companion, and clears each only on its own ack', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await askAtZeroHop(fakeCompanion({ contacts: { [A]: found(7) }, ack: restoreNeverAcks }).io, SELF, A, async () => {})
    await askAtZeroHop(fakeCompanion({ contacts: { [B]: found(3, 0xcd) }, ack: restoreNeverAcks }).io, SELF, B, async () => {})

    // Only B's restore acks this time: A stays owed, B is done.
    const next = fakeCompanion({ ack: (frame) => frame[1] === 0xcd })
    expect(await replayPendingRestores(next.io, SELF)).toBe(false)
    expect([...next.log].sort()).toEqual(['restore ab', 'restore cd'])
    const again = fakeCompanion()
    expect(await replayPendingRestores(again.io, SELF)).toBe(true)
    expect(again.log).toEqual(['restore ab'])
    expect(storage.items.size).toBe(0)
  })

  it('is replayed only against the companion it names', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await askAtZeroHop(fakeCompanion({ contacts: { [A]: found(7) }, ack: restoreNeverAcks }).io, SELF, A, async () => {})

    const other = fakeCompanion()
    await replayPendingRestores(other.io, OTHER)
    expect(other.log).toEqual([])
    expect(storage.items.size).toBe(1)
  })
})

// Neither reply carries a correlator, so the replay on connect and a dance
// must not overlap on the link: one could take the other's reply, and a dance
// could read a contact the replay is about to put back, then ask over the
// route it restored. Every write below waits until the test answers it, so the
// log shows what reached the companion while the other exchange was waiting.
describe('the link', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  let held = []
  const answer = async (ok) => { expect(held.length).toBe(1); held.shift()(ok); await tick() }
  const heldCompanion = (contacts) => fakeCompanion({ contacts, ack: () => new Promise((resolve) => held.push(resolve)) })
  const oweRestoreOfB = () => askAtZeroHop(fakeCompanion({ contacts: { [B]: found(3, 0xcd) }, ack: restoreNeverAcks }).io, SELF, B, async () => {})

  afterEach(async () => {
    for (let i = 0; i < 8 && held.length; i++) { held.shift()(false); await tick() }
    held = []
    vi.unstubAllGlobals()
  })

  it('holds a replay that starts during a dance until that dance has put its contact back', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await oweRestoreOfB()
    const c = heldCompanion({ [A]: found(7) })

    const dance = askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    const replay = replayPendingRestores(c.io, SELF)
    await tick()
    expect(c.log).toEqual(['read ab', 'override ab'])
    await answer(true)
    expect(c.log).toEqual(['read ab', 'override ab', 'ask', 'restore ab'])
    await answer(true)
    expect(c.log).toEqual(['read ab', 'override ab', 'ask', 'restore ab', 'restore cd'])
    await answer(true)
    expect(await dance).toEqual({ asked: true, restored: true })
    expect(await replay).toBe(true)
    expect(storage.items.size).toBe(0)
  })

  it('holds a dance that starts during the replay until every owed restore is back', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    await oweRestoreOfB()
    const c = heldCompanion({ [A]: found(7) })

    const replay = replayPendingRestores(c.io, SELF)
    const dance = askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })
    await tick()
    expect(c.log).toEqual(['restore cd'])
    await answer(true)
    expect(c.log).toEqual(['restore cd', 'read ab', 'override ab'])
    await answer(true)
    await answer(true)
    expect(await replay).toBe(true)
    expect(await dance).toEqual({ asked: true, restored: true })
    expect(c.log).toEqual(['restore cd', 'read ab', 'override ab', 'ask', 'restore ab'])
  })

  it('stays usable after an exchange that threw', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const broken = { getContact: async () => { throw new Error('link gone') }, writeContact: async () => true }
    await expect(askAtZeroHop(broken, SELF, A, async () => {})).rejects.toThrow('link gone')
    const c = fakeCompanion({ contacts: { [A]: found(0) } })
    expect(await askAtZeroHop(c.io, SELF, A, async () => { c.log.push('ask') })).toEqual({ asked: true })
    expect(c.log).toEqual(['read ab', 'ask'])
  })
})
