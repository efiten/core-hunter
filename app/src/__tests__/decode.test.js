import { describe, it, expect } from 'vitest'
import CryptoJS from 'crypto-js'
import { initDecoder, decodePacket, channelNameFor, bytesToHex, deriveChannelSecret } from '../decode.js'

// real 0-hop DIRECT Response packet captured live (sourceHash 4a)
const REAL_DIRECT = '0640774ad5974332ebc33dde2e08ef96b7b337d3358d'
// sha256(public secret) first byte — the 1-byte channel hash decode.js keys on
const PUBLIC_HASH1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse('8b3387e9c5cdea6ac9e5edbaa115cd72'))
  .toString(CryptoJS.enc.Hex).slice(0, 2)

describe('deriveChannelSecret', () => {
  it('derives the hashtag-channel key (golden vectors)', () => {
    expect(deriveChannelSecret('#test')).toBe('9cd8fcf22a47333b591d96a2b848b73f')
    expect(deriveChannelSecret('#chat')).toBe('d0bdd6d71538138ed979eec00d98ad97')
    expect(deriveChannelSecret('public')).toBe('8b4b705b080c0d943b1c80f6b3ef6b6d') // '#' prepended
  })
  it('initDecoder maps a derived channel name by its hash', () => {
    initDecoder({}, ['#test'])
    const h1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse('9cd8fcf22a47333b591d96a2b848b73f')).toString(CryptoJS.enc.Hex).slice(0, 2)
    expect(channelNameFor(h1)).toBe('#test')
  })
})

describe('decode', () => {
  it('decodes a real direct packet (type + pathLength + sourceHash)', () => {
    initDecoder({ public: '8b3387e9c5cdea6ac9e5edbaa115cd72' })
    const d = decodePacket(REAL_DIRECT)
    expect(d.payloadType).toBe(1)        // Response
    expect(d.pathLength).toBe(0)
    expect(d.payload.decoded.sourceHash.toLowerCase()).toBe('4a')
  })
  it('maps a configured channel key to its name by 1-byte hash', () => {
    initDecoder({ public: '8b3387e9c5cdea6ac9e5edbaa115cd72' })
    expect(channelNameFor(PUBLIC_HASH1)).toBe('public')
    expect(channelNameFor('zz')).toBeNull()
  })
  it('bytesToHex round-trips', () => {
    expect(bytesToHex(new Uint8Array([0xde, 0xad]))).toBe('dead')
  })
  it('returns null on a malformed packet instead of throwing', () => {
    initDecoder({ public: '8b3387e9c5cdea6ac9e5edbaa115cd72' })
    expect(decodePacket('zz')).toBeNull()
  })
})
