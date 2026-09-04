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
// the restore, the contact is left zero-hop on the companion. app.js stores
// this record before every override and clears it after a restore that
// acked: the original frame, which companion it belongs to (our own pubkey)
// and which contact, so it is only ever replayed against the same companion.
export const RESTORE_STORAGE_KEY = 'core-hunter-contact-restore'

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
