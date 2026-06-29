import { MeshCoreDecoder, getPayloadTypeName, bytesToHex as _bytesToHex } from '@michaelhart/meshcore-decoder'
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

export function channelNameFor(channelHash) {
  if (!channelHash) return null
  return hashToName[String(channelHash).toLowerCase()] || null
}

export { getPayloadTypeName }
