import { MeshCoreDecoder, getPayloadTypeName, getDeviceRoleName, bytesToHex as _bytesToHex } from '@michaelhart/meshcore-decoder'
import CryptoJS from 'crypto-js'

// Wrap the decoder's uppercase bytesToHex to return lowercase (consistent with the rest of the codebase).
export function bytesToHex(bytes) { return _bytesToHex(bytes).toLowerCase() }

let keyStore = null
let hashToName = {}

// deriveChannelSecret returns the first 16 bytes (32 hex chars) of SHA256(name),
// where name always includes the leading '#'.
export function deriveChannelSecret(name) {
  const n = name.startsWith('#') ? name : '#' + name
  return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(n)).toString(CryptoJS.enc.Hex).slice(0, 32)
}

// initDecoder builds the decryption keyStore + a 1-byte channel-hash → name map.
// channels (string[]) are derived first; explicit channelKeys override on name clash.
// Single-arg callers (no channels) still work — channels defaults to [].
export function initDecoder(channelKeys, channels = []) {
  const combined = {}
  for (const name of (channels || [])) {
    combined[name] = deriveChannelSecret(name)
  }
  for (const [name, hex] of Object.entries(channelKeys || {})) {
    combined[name] = hex
  }
  const secrets = Object.values(combined)
  keyStore = MeshCoreDecoder.createKeyStore({ channelSecrets: secrets })
  hashToName = {}
  for (const [name, hex] of Object.entries(combined)) {
    const h = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex)).toString(CryptoJS.enc.Hex)
    hashToName[h.slice(0, 2)] = name // firmware uses 1 byte of sha256(secret) as the channel hash
  }
}

export function decodePacket(rawHex) {
  try {
    return MeshCoreDecoder.decode(rawHex, keyStore ? { keyStore } : {})
  } catch (e) {
    return null
  }
}

// verifyAdvertSignature checks an Advert's Ed25519 signature over
// public_key + timestamp + app_data — the only cryptographic proof of identity
// MeshCore offers (#356). Everything else a packet claims about who sent it,
// including the hop count, is unauthenticated; see
// docs/2026-08-15-hop-count-trust.md.
//
// Reads signatureValid, NOT isValid. isValid is set true by the plain parse
// for any structurally sound packet and is only cleared once the decoder has
// actually reached the Ed25519 step, so it answers "this parsed" rather than
// "this is signed by the key it names" — a real non-advert packet comes back
// isValid: true, signatureValid: undefined. signatureValid exists only when
// verification ran, which makes `=== true` the only reading that fails closed
// through the paths where it did not: a non-advert, a malformed payload, and
// the decoder's own catch (it logs to console.error and leaves the packet
// otherwise untouched).
//
// Async, which is why it is a separate call rather than part of decodePacket():
// only Adverts pay for it, ~3% of captured traffic.
export async function verifyAdvertSignature(rawHex) {
  try {
    const v = await MeshCoreDecoder.decodeWithVerification(rawHex, keyStore ? { keyStore } : {})
    return v?.payload?.decoded?.signatureValid === true
  } catch (e) {
    return false
  }
}

export function channelNameFor(channelHash) {
  if (!channelHash) return null
  return hashToName[String(channelHash).toLowerCase()] || null
}

export { getPayloadTypeName, getDeviceRoleName }
