// The telemetry request (#553): the one directed probe a companion answers.
//
// A repeater answers a trace-ping by forwarding it; a companion with repeat
// off (the default) forwards nothing, answers no anonymous request and no
// Discover, and answers exactly one thing: a telemetry request from a sender
// it has as a contact (examples/companion_radio/MyMesh.cpp, onContactRequest;
// the firmware check is in the #553 thread). The reply is a RESPONSE datagram
// from the node at our position, a real measurement, plus its battery voltage
// and MCU temperature.
//
// Framing verified against MeshCore main 0679dbe / companion-v1.17.1.

// CMD_SEND_TELEMETRY_REQ: [39][3 bytes not read][pubkey 32]. The firmware
// requires len >= 4 + 32 and reads the pubkey at byte 4, looking the contact
// up by all 32 bytes, so nothing shorter than a full pubkey can be asked.
export const CMD_SEND_TELEMETRY_REQ = 39
// RESP_CODE_SENT: [6][1 = flood, 0 = direct][tag 4 LE][est_timeout 4 LE].
export const RESP_CODE_SENT = 6
// PUSH_CODE_TELEMETRY_RESPONSE: [0x8B][0][responder pubkey prefix 6][lpp...],
// from onContactResponse's pending_telemetry branch. The 4-byte timestamp the
// responder echoes is stripped by the firmware before the push.
export const PUSH_CODE_TELEMETRY_RESPONSE = 0x8b

const PUBKEY = /^[0-9a-f]{64}$/

export function buildTelemetryRequest(pubkeyHex) {
  const pk = String(pubkeyHex || '').trim().toLowerCase()
  if (!PUBKEY.test(pk)) throw new TypeError(`buildTelemetryRequest: pubkeyHex must be exactly 64 hex characters, got: ${pubkeyHex}`)
  const out = new Uint8Array(4 + 32)
  out[0] = CMD_SEND_TELEMETRY_REQ
  for (let i = 0; i < 32; i++) out[4 + i] = parseInt(pk.substr(i * 2, 2), 16)
  return out
}

export function parseSentAck(bytes) {
  if (!bytes || bytes.length < 10 || bytes[0] !== RESP_CODE_SENT) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { tag: v.getUint32(2, true), isFlood: bytes[1] === 1, estTimeoutMs: v.getUint32(6, true) }
}

// CayenneLPP field sizes (helpers/sensors/LPPDataHelpers.h, and the
// electroniccats/CayenneLPP 1.6.1 library the firmware builds with): the two
// the companion adds are read, the rest are skipped by size, and an unknown
// type ends the walk rather than guessing a size.
const LPP_TEMPERATURE = 103 // 2 bytes, 0.1 °C signed
const LPP_VOLTAGE = 116     // 2 bytes, 0.01 V unsigned
const LPP_SIZE = {
  0: 1, 1: 1, 2: 2, 3: 2, 100: 4, 101: 2, 102: 1, 103: 2, 104: 1, 113: 6, 115: 2,
  116: 2, 117: 2, 118: 4, 120: 1, 121: 2, 125: 2, 128: 2, 130: 4, 131: 4, 132: 2,
  133: 4, 134: 6, 135: 3, 136: 9, 142: 1,
}

export function parseLpp(bytes) {
  const out = {}
  let i = 0
  while (bytes && i + 2 <= bytes.length) {
    const type = bytes[i + 1]
    const size = LPP_SIZE[type]
    if (size == null || i + 2 + size > bytes.length) break
    const at = i + 2
    if (type === LPP_VOLTAGE) out.voltage_v = ((bytes[at] << 8) | bytes[at + 1]) / 100
    else if (type === LPP_TEMPERATURE) {
      const raw = (bytes[at] << 8) | bytes[at + 1]
      out.temp_c = (raw >= 0x8000 ? raw - 0x10000 : raw) / 10
    }
    i = at + size
  }
  return out
}

export function parseTelemetryResponse(bytes) {
  if (!bytes || bytes.length < 8 || bytes[0] !== PUSH_CODE_TELEMETRY_RESPONSE) return null
  let prefix = ''
  for (let i = 2; i < 8; i++) prefix += bytes[i].toString(16).padStart(2, '0')
  return { prefix, telemetry: parseLpp(bytes.slice(8)) }
}

// Attributing the reply. The RESPONSE packet on the RX log carries only the
// 1-byte source hash, so like a trace reply (#481) it is matched to the ask we
// sent: the pending ask whose pubkey starts with that byte, while the ask is
// live. Two live asks sharing a first byte are refused rather than guessed,
// and a 1-in-256 collision with a stranger answers exactly like the target
// would; the 0x8B push, carrying six bytes, is what settles the identity.
export const ASK_TTL_MS = 30000

export function pruneAsks(pending, now, ttlMs = ASK_TTL_MS) {
  return (pending || []).filter((a) => now - a.sentAt < ttlMs)
}

export function rememberAsk(pending, pubkeyHex, sentAt, ttlMs = ASK_TTL_MS) {
  const pk = String(pubkeyHex || '').trim().toLowerCase()
  if (!PUBKEY.test(pk)) return pending || []
  return [...pruneAsks(pending, sentAt, ttlMs).filter((a) => a.pubkey !== pk), { pubkey: pk, sentAt }]
}

export function matchTelemetryTarget(pending, srcHashHex, now, ttlMs = ASK_TTL_MS) {
  const h = String(srcHashHex || '').trim().toLowerCase()
  if (!/^[0-9a-f]{2}$/.test(h)) return null
  const hits = pruneAsks(pending, now, ttlMs).filter((a) => a.pubkey.startsWith(h))
  return hits.length === 1 ? hits[0].pubkey : null
}

// One ask per cycle, rotating over the selected companions: the firmware keeps
// one pending telemetry tag (clearPendingReqs on every send), so a second ask
// in flight would orphan the first reply. The cursor only ever grows; a list
// that shrank still lands inside it.
export function nextTelemetryTarget(ids, cursor) {
  if (!ids || ids.length === 0) return null
  const c = Math.max(0, Number(cursor) || 0)
  return { id: ids[c % ids.length], cursor: c + 1 }
}
