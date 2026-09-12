// Contact-path override (#553), ported from efiten/coredrive-rx contactpath.js.
//
// The companion picks flood versus direct routing itself: sendRequest
// (src/helpers/BaseChatMesh.cpp) floods when the contact's out_path_len is
// OUT_PATH_UNKNOWN (0xFF) and otherwise sends DIRECT over whatever path is
// stored, which may be a stale multi-hop path from earlier flooded traffic.
// The app asks nothing over a flood: a probe target is by construction a node
// we hear zero-hop, so for the one ask the contact is forced to zero-hop
// first, and put back exactly as it was afterwards, whether the ask went out,
// failed or timed out.
//
// Frame layout: writeContactRespFrame and updateContactFromFrame
// (examples/companion_radio/MyMesh.cpp:166, 189) use the same field order, so
// a CMD_GET_CONTACT_BY_KEY reply becomes a CMD_ADD_UPDATE_CONTACT command by
// rewriting byte 0, and the override by rewriting byte 35 as well:
//   code(1) pub_key(32) type(1) flags(1) out_path_len(1) out_path(64)
//   name(32) last_advert_timestamp(4) gps_lat(4) gps_lon(4) lastmod(4) = 148.

export const CMD_GET_CONTACT_BY_KEY = 30 // examples/companion_radio/MyMesh.cpp:35
export const CMD_ADD_UPDATE_CONTACT = 9  // MyMesh.cpp:14
export const RESP_CODE_OK = 0            // MyMesh.cpp:71, CMD_ADD_UPDATE_CONTACT's success reply
export const RESP_CODE_ERR = 1           // MyMesh.cpp:72
export const RESP_CODE_CONTACT = 3       // MyMesh.cpp:74, CMD_GET_CONTACT_BY_KEY's success reply
export const ERR_CODE_NOT_FOUND = 2      // MyMesh.cpp:131
export const CONTACT_FRAME_LEN = 148
const OUT_PATH_LEN_OFFSET = 35

const PUBKEY = /^[0-9a-f]{64}$/

function pubkeyBytes(pubkeyHex, fn) {
  const pk = String(pubkeyHex || '').trim().toLowerCase()
  if (!PUBKEY.test(pk)) throw new TypeError(`${fn}: pubkeyHex must be exactly 64 hex characters, got: ${pubkeyHex}`)
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(pk.substr(i * 2, 2), 16)
  return { pk, bytes: out }
}

function hex(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

export function buildGetContactByKey(pubkeyHex) {
  const { bytes } = pubkeyBytes(pubkeyHex, 'buildGetContactByKey')
  const out = new Uint8Array(33)
  out[0] = CMD_GET_CONTACT_BY_KEY
  out.set(bytes, 1)
  return out
}

// parseContactReply reads a CMD_GET_CONTACT_BY_KEY reply:
//  - { found: true, pubkey, outPathLen, raw } for RESP_CODE_CONTACT, raw being
//    the whole 148-byte frame kept verbatim so it can be echoed back later;
//  - { found: false } for ERR_CODE_NOT_FOUND (not a contact, so no override);
//  - null for anything else: a wrong code, a foreign error, or a frame too
//    short to be the one it claims to be. Half a frame echoed back would
//    rewrite the contact with garbage, so it is rejected, never half-parsed.
export function parseContactReply(bytes) {
  if (!bytes || bytes.length < 1) return null
  if (bytes[0] === RESP_CODE_ERR) {
    return bytes.length >= 2 && bytes[1] === ERR_CODE_NOT_FOUND ? { found: false } : null
  }
  if (bytes[0] === RESP_CODE_CONTACT && bytes.length >= CONTACT_FRAME_LEN) {
    const raw = Uint8Array.from(bytes.slice(0, CONTACT_FRAME_LEN))
    return { found: true, pubkey: hex(raw.slice(1, 33)), outPathLen: raw[OUT_PATH_LEN_OFFSET], raw }
  }
  return null
}

// needsPathOverride: only a found contact whose stored routing would not send
// this ask over the zero-hop link needs the override. 0xFF (unknown) floods,
// any other non-zero value source-routes over a path that may be stale.
export function needsPathOverride(contact) {
  return !!(contact && contact.found && contact.outPathLen !== 0)
}

// buildOverrideFrame turns the raw reply into a CMD_ADD_UPDATE_CONTACT that
// forces out_path_len to 0. Every other byte, last_mod included, is echoed:
// updateContactFromFrame falls back to "now" for a missing last_mod, so
// dropping it would silently rewrite the contact's modification time.
export function buildOverrideFrame(raw) {
  const out = Uint8Array.from(raw)
  out[0] = CMD_ADD_UPDATE_CONTACT
  out[OUT_PATH_LEN_OFFSET] = 0
  return out
}

// buildRestoreFrame turns the ORIGINAL raw reply, never the override, into the
// command that puts the contact back exactly as it was.
export function buildRestoreFrame(raw) {
  const out = Uint8Array.from(raw)
  out[0] = CMD_ADD_UPDATE_CONTACT
  return out
}

// Crash safety. If the app dies or BLE drops between the override write and
// the restore, the contact is left zero-hop on the companion. askAtZeroHop
// stores this record before every override, makes no override when it cannot,
// and clears it after a restore that acked: the original frame, which
// companion it belongs to (our own pubkey) and which contact, so it is only
// ever replayed against the same companion. Each companion and contact has its
// own key: a later ask, to another contact or from another companion, must not
// overwrite a restore that is still owed.
const RESTORE_KEY_PREFIX = 'core-hunter-contact-restore:'

const lower = (hexId) => String(hexId).trim().toLowerCase()

function restoreKey(self, target) {
  return `${RESTORE_KEY_PREFIX}${lower(self)}:${lower(target)}`
}

export function encodePendingRestore(selfPubkeyHex, targetPubkeyHex, raw) {
  return JSON.stringify({
    self: String(selfPubkeyHex).trim().toLowerCase(),
    target: String(targetPubkeyHex).trim().toLowerCase(),
    raw: hex(raw),
  })
}

// decodePendingRestore returns { self, target, raw } or null for anything that
// is not a well-formed record.
export function decodePendingRestore(json) {
  let rec
  try { rec = JSON.parse(json) } catch (_) { return null }
  if (!rec || typeof rec !== 'object' || typeof rec.self !== 'string' || typeof rec.target !== 'string' || typeof rec.raw !== 'string') return null
  if (!/^[0-9a-f]*$/i.test(rec.raw) || rec.raw.length !== CONTACT_FRAME_LEN * 2) return null
  const raw = new Uint8Array(CONTACT_FRAME_LEN)
  for (let i = 0; i < CONTACT_FRAME_LEN; i++) raw[i] = parseInt(rec.raw.substr(i * 2, 2), 16)
  return { self: rec.self.toLowerCase(), target: rec.target.toLowerCase(), raw }
}

// The companion's replies to a contact read and a contact write carry no
// correlator, so two exchanges on the link at once can take each other's
// replies, and a dance that reads a contact the replay is about to put back
// sends its ask over the route the replay restored. So every dance and every
// replay takes its turn: each starts once the one before it has settled,
// whether it resolved or threw.
let linkTurn = Promise.resolve()

function onLink(exchange) {
  const run = linkTurn.then(exchange)
  linkTurn = run.catch(() => {})
  return run
}

// The dance itself. `io` is the companion link as app.js wires it:
//   io.getContact(pubkey)  resolves with parseContactReply's reading of the
//                          reply, or null when none came;
//   io.writeContact(frame) resolves true on RESP_CODE_OK, false on
//                          RESP_CODE_ERR, null when no reply came.
// It waits for its turn on the link (onLink). `ask` sends the one command the
// contact is held zero-hop for. The result is { asked } and, when it did not
// ask, { skipped } saying why; `restored` says whether the restore it wrote
// acked.
export function askAtZeroHop(io, self, target, ask) {
  return onLink(() => dance(io, self, target, ask))
}

async function dance(io, self, target, ask) {
  const contact = await io.getContact(target)
  // No answer says nothing about the stored route, and the unknown route is
  // the one the firmware floods, so no reading means no ask.
  if (!contact) return { asked: false, skipped: 'the contact read got no answer' }
  // Not a contact yet: our companion has not heard its advert, or has no slot.
  if (!contact.found) return { asked: false, skipped: 'not a contact yet' }
  if (!needsPathOverride(contact)) {
    await ask()
    return { asked: true }
  }
  // Without the record a dropped link would leave the contact zero-hop with
  // nothing to replay, so where storage refuses it the contact is not touched.
  try {
    localStorage.setItem(restoreKey(self, target), encodePendingRestore(self, target, contact.raw))
  } catch (_) {
    return { asked: false, skipped: 'the restore record could not be stored' }
  }
  // No override, no ask: the firmware would flood it (#553, "geen flood").
  let out = { asked: false, skipped: 'the path override did not ack' }
  try {
    if (await io.writeContact(buildOverrideFrame(contact.raw))) {
      await ask()
      out = { asked: true }
    }
  } finally {
    out.restored = await restoreContact(io, self, target, contact.raw)
  }
  return out
}

// restoreContact puts the original contact frame back. Its record is cleared
// only once the restore acked; otherwise the next connect to this same
// companion replays it.
async function restoreContact(io, self, target, raw) {
  if (!(await io.writeContact(buildRestoreFrame(raw)))) return false
  try { localStorage.removeItem(restoreKey(self, target)) } catch (_) {}
  return true
}

// replayPendingRestores runs once per connect: a session that died between an
// override and its restore left that contact zero-hop on the companion. Every
// record for the connected companion is replayed, and each is cleared on its
// own ack. It takes its turn on the link like a dance. Resolves with whether
// every restore acked, or null when none was owed.
export function replayPendingRestores(io, self) {
  return onLink(() => replay(io, self))
}

async function replay(io, self) {
  const stored = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(RESTORE_KEY_PREFIX)) stored.push([key, localStorage.getItem(key)])
    }
  } catch (_) { return null }
  let owed = false
  let allAcked = true
  for (const [key, value] of stored) {
    const rec = decodePendingRestore(value || '')
    if (!rec) { try { localStorage.removeItem(key) } catch (_) {} continue }
    if (rec.self !== lower(self)) continue
    owed = true
    if (!(await restoreContact(io, rec.self, rec.target, rec.raw))) allAcked = false
  }
  return owed ? allAcked : null
}
