import { describe, it, expect } from 'vitest'
import CryptoJS from 'crypto-js'
import { initDecoder, decodePacket, channelNameFor, bytesToHex, deriveChannelSecret, verifyAdvertSignature } from '../decode.js'

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


// A real zero-hop Advert captured by a hunter (NL-OV-ENS-ESNODE, a public
// repeater beacon — adverts are broadcast in the clear and this node is
// already on the public map, so the fixture exposes nothing new). Signature
// verification is the only cryptographic check MeshCore offers on an identity,
// and a real packet is the only honest way to test it: constructing one in the
// test would just re-implement the message format being verified (#356).
const REAL_ADVERT = '12004250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb806202a6e7b6aaf114f76dbd2afc6e732160cab0f45881163c98535dc5177f8e04ac796da9108cfb21bf5657452e23ed12f1007194e8da4937179ce214abf2465272e541ef80d929cda1c03b88d69004e4c2d4f562d454e532d45534e4f4445'

describe('verifyAdvertSignature', () => {
  it('accepts a genuine advert', async () => {
    expect(await verifyAdvertSignature(REAL_ADVERT)).toBe(true)
  })

  it('rejects the same advert with a tampered byte', async () => {
    const tail = REAL_ADVERT.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa'
    expect(await verifyAdvertSignature(REAL_ADVERT.slice(0, -4) + tail)).toBe(false)
  })

  it('rejects a tampered name, not just a broken signature', async () => {
    // Flip a byte in the middle (app data), where a forger would actually
    // work — the signature covers pubkey + timestamp + appData.
    const i = Math.floor(REAL_ADVERT.length / 2)
    const flipped = REAL_ADVERT.slice(0, i) + (REAL_ADVERT[i] === '0' ? '1' : '0') + REAL_ADVERT.slice(i + 1)
    expect(await verifyAdvertSignature(flipped)).toBe(false)
  })

  // The decoder swallows a verification throw into console.error and leaves
  // isValid untouched, so anything short of an explicit true must read as
  // false — this must fail closed, not open.
  it('fails closed on junk input', async () => {
    for (const junk of ['', 'zz', 'ff', null, undefined]) {
      expect(await verifyAdvertSignature(junk)).toBe(false)
    }
  })
})
