// Anonymous requests to a repeater (#552): its regions and clock, and its owner
// info. A simple_repeater answers both without a login, out of one bucket of
// 4 answers per 180 s (examples/simple_repeater/MyMesh.cpp, anon_limiter), and
// only over a direct route (onAnonDataRecv requires isRouteDirect()). Every
// answer is a zero-hop RESPONSE from that repeater: a measurement at our
// position, plus what it says about itself.
//
// Framing ported from efiten/coredrive-rx src/regionreq.js, which runs the
// regions ask in the field, and checked against MeshCore main:
//   request  CMD_SEND_ANON_REQ [57][pubkey 32][type][reply_path_len]
//            (companion_radio/MyMesh.cpp; sendAnonReq prepends a 4-byte tag,
//            which the repeater echoes as its "sender_timestamp")
//   ack      RESP_CODE_SENT [6][flood][tag 4][est_timeout 4]
//   reply    PUSH_CODE_BINARY_RESPONSE [0x8C][0][tag 4][data], data being the
//            repeater's reply after its 4-byte echo: [clock 4 LE][...]
//   regions  ANON_REQ_TYPE_REGIONS 0x01: ...[region CSV]
//   owner    ANON_REQ_TYPE_OWNER 0x02: ...["node_name\nowner_info"]
// The companion adds a repeater that is not a contact yet as one, zero-hop
// (FIRMWARE_VER_CODE 13+), so the ask needs no contact first.

export const CMD_SEND_ANON_REQ = 57
export const ANON_REQ_TYPE_REGIONS = 0x01
export const ANON_REQ_TYPE_OWNER = 0x02
export const PUSH_CODE_BINARY_RESPONSE = 0x8c

// The repeater's CSV budget is 172 bytes, and RegionMap::exportNamesTo skips a
// name that does not fit and goes on, so an overflowing list has holes with no
// marker. A 30-byte name can be dropped once 140 bytes are written, and the
// trailing comma is trimmed, so a list of 139 bytes or more may hide one
// (derivation in coredrive-rx regionreq.js).
export const TRUNCATION_WARN_BYTES = 139

// At most one anonymous ask per target per minute: the bucket refills at 4 per
// 180 s, and an ask it refuses is airtime spent for nothing (#552).
export const ANON_MIN_GAP_MS = 60000

const PUBKEY = /^[0-9a-f]{64}$/
const TYPES = new Set([ANON_REQ_TYPE_REGIONS, ANON_REQ_TYPE_OWNER])

export function buildAnonRequest(pubkeyHex, type) {
  const pk = String(pubkeyHex || '').trim().toLowerCase()
  if (!PUBKEY.test(pk)) throw new TypeError(`buildAnonRequest: pubkeyHex must be exactly 64 hex characters, got: ${pubkeyHex}`)
  if (!TYPES.has(type)) throw new TypeError(`buildAnonRequest: unknown request type ${type}`)
  const out = new Uint8Array(1 + 32 + 2)
  out[0] = CMD_SEND_ANON_REQ
  for (let i = 0; i < 32; i++) out[1 + i] = parseInt(pk.substr(i * 2, 2), 16)
  out[33] = type
  out[34] = 0x00 // reply_path_len: the reply comes back zero-hop
  return out
}

// parseBinaryResponse reads a 0x8C push: the tag that matches it to our ack,
// and the reply data after it, starting with the repeater's clock.
export function parseBinaryResponse(bytes) {
  if (!bytes || bytes.length < 10 || bytes[0] !== PUSH_CODE_BINARY_RESPONSE) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { tag: v.getUint32(2, true), data: bytes.slice(6) }
}

// The reply is encrypted with a block cipher, so the plaintext arrives
// NUL-padded to 16 bytes and the firmware's own length does not come with it.
// Left in, the padding lands inside the last name (coredrive-rx measured 48 of
// 65 stored region lists carrying it).
function body(data) {
  let end = data.length
  while (end > 4 && data[end - 1] === 0) end--
  return data.slice(4, end)
}
const clockOf = (data) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true)

export function readRegionsReply(data) {
  const csv = body(data)
  const text = new TextDecoder().decode(csv)
  // Bytes, not characters: the budget is bytes, and a name may carry bytes >= 0x80.
  return { repeaterClock: clockOf(data), regions: text.length ? text.split(',') : [], truncated: csv.length >= TRUNCATION_WARN_BYTES }
}

export function readOwnerReply(data) {
  const text = new TextDecoder().decode(body(data))
  const nl = text.indexOf('\n')
  return { repeaterClock: clockOf(data), name: nl === -1 ? text : text.slice(0, nl), owner: nl === -1 ? '' : text.slice(nl + 1) }
}

// nextAnonAsk picks the one anonymous ask of this cycle: among the selected
// repeaters with a full pubkey and no ask in the last minute, the one asked
// longest ago (never asked first), for the kind it was not asked last. `last`
// is { [pubkey]: { at, type } }. null when nothing is due.
export function nextAnonAsk(ids, last, now) {
  let best = null
  for (const raw of ids || []) {
    const id = String(raw).toLowerCase()
    if (!PUBKEY.test(id)) continue
    const l = last && last[id]
    if (l && now - l.at < ANON_MIN_GAP_MS) continue
    const at = l ? l.at : -Infinity
    if (!best || at < best.at) best = { id, at, type: l && l.type === ANON_REQ_TYPE_REGIONS ? ANON_REQ_TYPE_OWNER : ANON_REQ_TYPE_REGIONS }
  }
  return best ? { id: best.id, type: best.type } : null
}

// directedAskKind: which directed ask this cycle carries. The companion keeps
// one pending request and clears it on every send (clearPendingReqs), so a
// telemetry ask and an anonymous ask in one cycle would orphan a reply. When
// both are due they take turns, telemetry first.
export function directedAskKind({ telemetryDue, anonDue, last }) {
  if (telemetryDue && anonDue) return last === 'telemetry' ? 'anon' : 'telemetry'
  if (telemetryDue) return 'telemetry'
  if (anonDue) return 'anon'
  return null
}
