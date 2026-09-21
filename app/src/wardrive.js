// The wardrive format (#554): what a moving receiver publishes so a consumer
// can place a reception on a map and triangulate from it. Two messages:
//
//   obs    one reception, with the position it was heard at
//   track  one listening interval: where the phone was, for how long, and how
//          many packets it heard. rx_count 0 while listening is silence
//          evidence, which a triangulator uses as a negative constraint.
//
// Topics are meshcore/{label}/{PUBKEY}/wardriver/obs and .../wardriver/track,
// where {label} is a stream label (hunter) rather than an airport code: a
// moving receiver is not a fixed observer and must not be read as one.
//
// Pure. The byte layout below is the firmware's (src/Packet.h, src/Packet.cpp):
//   header       route type in bits 0-1, payload type in bits 2-5
//   transport    2x uint16, only on route types 0 and 3
//   path_len     hop count in bits 0-5, (hash size - 1) in bits 6-7
//   path         count x size bytes
//   payload      the rest
import { hexToBytes } from './meshpacket.js'
import { haversineM } from './geometry.js'

const ROUTE_TRANSPORT_FLOOD = 0
const ROUTE_FLOOD = 1
const ROUTE_DIRECT = 2
const ROUTE_TRANSPORT_DIRECT = 3
const PAYLOAD_TYPE_TRACE = 0x09
const MAX_PATH_SIZE = 64
const HASH_BYTES = 8 // MAX_HASH_SIZE

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// frameWalk reads a raw frame's routing preamble. null when the frame is too
// short, its path length is not valid (Packet::isValidPathLen), or there is no
// payload left.
export function frameWalk(raw) {
  if (!raw || raw.length < 2) return null
  const header = raw[0]
  const routeType = header & 0x03
  let i = 1
  if (routeType === ROUTE_TRANSPORT_FLOOD || routeType === ROUTE_TRANSPORT_DIRECT) i += 4
  if (i >= raw.length) return null
  const pathLen = raw[i++]
  const count = pathLen & 63
  const size = (pathLen >> 6) + 1
  if (size === 4 || count * size > MAX_PATH_SIZE) return null
  const hops = []
  for (let k = 0; k < count; k++) hops.push(toHex(raw.subarray(i + k * size, i + (k + 1) * size)))
  i += count * size
  if (i >= raw.length) return null
  return { routeType, payloadType: (header >> 2) & 0x0f, pathLen, hops, payloadStart: i }
}

async function hashOf(raw, w) {
  // Packet::calculatePacketHash: the payload type, then for a TRACE the
  // path_len as a uint16 (little-endian, so the byte and a zero), then the
  // payload. The route and the path are left out, so a packet keeps one
  // identity however it travelled.
  const prefix = w.payloadType === PAYLOAD_TYPE_TRACE ? [w.payloadType, w.pathLen, 0] : [w.payloadType]
  const payload = raw.subarray(w.payloadStart)
  const buf = new Uint8Array(prefix.length + payload.length)
  buf.set(prefix, 0)
  buf.set(payload, prefix.length)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return toHex(new Uint8Array(digest).subarray(0, HASH_BYTES))
}

// packetHash returns the firmware's packet hash for a raw frame in hex: 8
// bytes, lowercase. null when the frame cannot be walked.
export async function packetHash(rawHex) {
  const raw = hexToBytes(rawHex || '')
  const w = frameWalk(raw)
  return w ? hashOf(raw, w) : null
}

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp

// buildObs turns a stored reception (capture.js buildRecord) into an obs.
// null when the frame cannot be hashed: without the hash a consumer cannot
// join it to anything. Six decimals is about 11 cm, more than a phone fix can
// justify; accuracy is left out when the phone gave none, never sent as 0.
export async function buildObs(rec, { originId, pubAt } = {}) {
  const raw = hexToBytes(rec.raw || '')
  const w = frameWalk(raw)
  if (!w) return null
  const obs = { v: 1, origin_id: originId, rx_at: rec.rx_at }
  if (pubAt) obs.pub_at = pubAt
  obs.hash = await hashOf(raw, w)
  obs.raw = toHex(raw)
  obs.len = raw.length
  obs.packet_type = w.payloadType
  if (w.routeType === ROUTE_FLOOD || w.routeType === ROUTE_TRANSPORT_FLOOD) obs.route = 'F'
  else if (w.routeType === ROUTE_DIRECT || w.routeType === ROUTE_TRANSPORT_DIRECT) obs.route = 'D'
  obs.payload_len = raw.length - w.payloadStart
  obs.path = w.hops
  if (Number.isFinite(rec.rssi)) obs.RSSI = rec.rssi
  if (Number.isFinite(rec.snr)) obs.SNR = rec.snr
  obs.pos = { lat: round(rec.lat, 6), lon: round(rec.lon, 6) }
  if (Number.isFinite(rec.acc_m)) obs.pos.accuracy = round(rec.acc_m, 1)
  obs.pos.src = 'phone'
  return obs
}

// buildTrack assembles one listening interval. `listening` has to be exactly
// true to be sent as true: a dropped radio that still claimed to be listening
// would turn a connection gap into silence on the air.
export function buildTrack({ originId, t0, t1, lat, lon, accM, rxCount, listening }) {
  const tk = { v: 1, origin_id: originId, t0, t1, lat: round(lat, 6), lon: round(lon, 6) }
  if (Number.isFinite(accM)) tk.accuracy = round(accM, 1)
  tk.rx_count = Number.isFinite(rxCount) ? rxCount : 0
  tk.listening = listening === true
  tk.src = 'phone'
  return tk
}

// A track is due every 10 s or every 25 m, whichever comes first: the cadence
// the DutchMeshCore collector uses at its default detail level, so our
// rx_count per interval reads the same as theirs.
export const TRACK_INTERVAL_S = 10
export const TRACK_DISTANCE_M = 25

export function shouldEmitTrack({ nowMs, lastMs, lastPos, curPos }) {
  if (lastMs == null) return true
  if (nowMs - lastMs >= TRACK_INTERVAL_S * 1000) return true
  return Boolean(lastPos && curPos) && haversineM(lastPos, curPos) >= TRACK_DISTANCE_M
}

export function obsTopic(label, pubkeyHex) {
  return `meshcore/${label}/${String(pubkeyHex).toUpperCase()}/wardriver/obs`
}

export function trackTopic(label, pubkeyHex) {
  return `meshcore/${label}/${String(pubkeyHex).toUpperCase()}/wardriver/track`
}
