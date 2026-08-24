import { getPayloadTypeName, getDeviceRoleName } from './decode.js'

const PT_ADVERT = 4
const PT_GROUP_TEXT = 5
const PT_TRACE = 9 // path bytes are per-hop SNR, not node ids — never attributable

// Route type = low 2 header bits. FLOOD routes append forwarders at the END of
// the path, so path[last] is the immediate RF transmitter (a relay we heard
// directly). DIRECT routes consume from the front, so their path[last] is not
// who we heard — skip. (Ported from corescope-rx / CoreScope's deriveHeardKey.)
function isFloodRoute(rt) { return rt === 0 || rt === 1 }

export function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// carriesSignedIdentity reports whether a classification's identity can be
// checked at all. Only an Advert is signed (Ed25519 over pubkey + timestamp +
// app data), and it is also the only kind whose identity feeds name resolution
// and the node-position layer — so it is both the one worth verifying and the
// only one that can be (#356). Everything else names its sender with an
// unauthenticated path hash, prefix or channel-key-derived string.
export function carriesSignedIdentity(cls) {
  return !!cls && !!cls.sender && cls.sender.kind === 'advert_pubkey'
}

// The empty identity: what a reception carries when nothing about who sent it
// may be believed. Shared by both refusals below so they cannot drift apart.
const NO_SENDER = () => ({ kind: null, id: null, label: null, role: null })

// stripIdentity returns the same reception with its identity removed (#454).
// Used for an Advert whose Ed25519 signature does not verify: the claim is
// refused, the measurement is not. RSSI, SNR and our own GPS fix were made by
// our radio and cannot be forged; the pubkey, the name and the advertised
// position are exactly the parts an attacker writes, so they go — rather than
// the whole reception, which is what #356 did and what #455 stopped doing for
// every other unattributable class.
//
// Returns a new object: the caller still reads the original (its text and its
// id, for the console warning) after the strip.
export function stripIdentity(cls) {
  return { ...cls, sender: NO_SENDER() }
}

// undecodableReception is the classification for a packet that did not decode
// at all (#454 class 5) — either the decoder threw, or it reported the packet
// structurally unsound. The 0x88 frame's SNR and RSSI are read before the
// decoder ever runs (frames.js), so the measurement is intact and the packet
// is still a reception: something transmitted here, this strongly.
//
// It cannot be built from what the decoder returns. Both of its error paths
// hand back a fully-formed packet whose fields are placeholders rather than
// readings — payloadType RawCustom, routeType Flood, pathLength 0, path null —
// so classifying that packet would file junk under the real "Raw" chip and
// state a hop count nobody measured.
//
// hops stays 0 because the ingestor's column is NOT NULL and its parser takes
// hops as a value type, so a null would arrive as 0 anyway, unmarked. The type
// is what carries "unknown" here, on both surfaces and in the ?types= query.
export function undecodableReception() {
  return { packetType: 'Unknown', hops: 0, isDirect: false, sender: NO_SENDER(), channel: null, text: null }
}

export function classifyReception(decoded, channelNameFor = () => null) {
  const pt = decoded.payloadType
  const hops = decoded.pathLength || 0
  const d = (decoded.payload && decoded.payload.decoded) || {}
  let sender = { kind: null, id: null, label: null }
  let channel = null
  let text = null
  // "heard directly" = we received the sender node's own transmission: the
  // original sender at 0 hops, OR the last relay (path[last]) of a FLOOD packet
  // (that relay re-broadcast to us, so we heard it directly). Both are valid
  // location measurements; only these are captured.
  let heardDirect = false

  if (pt === PT_TRACE) {
    // never attributable — path bytes are SNR values, not hop hashes
  } else if (hops > 0) {
    // relayed: only a FLOOD route's path[last] is the immediate transmitter.
    if (isFloodRoute(decoded.routeType) && Array.isArray(decoded.path) && decoded.path.length) {
      const last = String(decoded.path[decoded.path.length - 1]).toLowerCase()
      if (last.length >= 4) { // >= 2 bytes; 1-byte hashes are collision-prone
        sender = { kind: 'relay', id: last, role: null, label: null }
        heardDirect = true
      }
    }
    if (pt === PT_GROUP_TEXT) channel = channelNameFor(d.channelHash)
  } else if (pt === PT_ADVERT && d.publicKey) {
    const role = d.appData && d.appData.deviceRole != null ? getDeviceRoleName(d.appData.deviceRole) : null
    sender = { kind: 'advert_pubkey', id: d.publicKey.toLowerCase(), role, label: (d.appData && d.appData.name) || null }
    heardDirect = true
  } else if (pt === PT_GROUP_TEXT) {
    channel = channelNameFor(d.channelHash)
    if (d.decrypted && d.decrypted.sender) {
      sender = { kind: 'channel_name', id: d.decrypted.sender, label: d.decrypted.sender }
      text = d.decrypted.message || null
      heardDirect = true
    }
  } else if (d.publicKey) {
    // Discover/Control reply: carries the responding node's pubkey prefix + type
    // (that's what a discover is FOR — which, and what kind of, nodes are nearby).
    // No name in the packet → label stays null so the name is resolved by ID later.
    const id = d.publicKey.toLowerCase()
    sender = { kind: 'discover_pubkey', id, role: d.nodeTypeName || null, label: null }
    heardDirect = true
  } else if (d.sourceHash) {
    const id = String(d.sourceHash).toLowerCase()
    sender = { kind: 'direct_hash', id, label: id }
    heardDirect = true
  }

  return { packetType: getPayloadTypeName(pt), hops, isDirect: heardDirect, sender, channel, text }
}
