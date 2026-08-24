import { describe, it, expect, vi, afterEach } from 'vitest'
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder'
import { decodePacket, verifyAdvertSignature } from '../decode.js'
import { classifyReception, stripIdentity, undecodableReception, hexToBytes } from '../meshpacket.js'
import { buildRecord, shouldCapture } from '../capture.js'

// The same real zero-hop Advert decode.test.js verifies against
// (NL-OV-ENS-ESNODE, a public repeater beacon). A forged identity can only be
// tested against a real signed packet: building one here would re-implement
// the message format under test (#356).
const REAL_ADVERT = '12004250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb806202a6e7b6aaf114f76dbd2afc6e732160cab0f45881163c98535dc5177f8e04ac796da9108cfb21bf5657452e23ed12f1007194e8da4937179ce214abf2465272e541ef80d929cda1c03b88d69004e4c2d4f562d454e532d45534e4f4445'
const flip = (hex, i) => hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1)
// The 64-byte signature sits at hex offsets 76-203; the name is the tail.
const BROKEN_SIG = flip(REAL_ADVERT, 128)
const FORGED_NAME = flip(REAL_ADVERT, REAL_ADVERT.length - 3)

const fix = { lat: 51.5, lon: 4.5, acc_m: 8 }
const frameFor = (hex) => ({ snr: -4.25, rssi: -97, raw: hexToBytes(hex) })

// What app.js does per frame, composed from the same units in the same order.
// The steps are individually tested; this pins that putting them together
// keeps the measurement and loses the identity, which is the whole of #454.
async function capture(hex) {
  const decoded = decodePacket(hex)
  let cls = decoded && decoded.isValid ? classifyReception(decoded) : undecodableReception()
  if (cls.sender.kind === 'advert_pubkey' && !(await verifyAdvertSignature(hex))) cls = stripIdentity(cls)
  if (!shouldCapture(cls, fix)) return null
  return buildRecord(frameFor(hex), cls, fix, '2026-08-24T12:00:00Z')
}

afterEach(() => { vi.restoreAllMocks() })

describe('an advert that does not verify is stripped, not dropped (#454 class 4)', () => {
  it('keeps a genuine advert whole, identity included', async () => {
    const rec = await capture(REAL_ADVERT)
    expect(rec.sender_kind).toBe('advert_pubkey')
    expect(rec.sender_id).toHaveLength(64)
    expect(rec.packet_type).toBe('Advert')
  })

  it('stores the reception when the signature is broken', async () => {
    const rec = await capture(BROKEN_SIG)
    expect(rec).not.toBeNull()
    expect(rec.rssi).toBe(-97)
    expect(rec.snr).toBe(-4.25)
    expect(rec.lat).toBe(51.5)
    expect(rec.lon).toBe(4.5)
    expect(rec.packet_type).toBe('Advert')
  })

  it('lets no part of the claimed identity survive on that row', async () => {
    const rec = await capture(BROKEN_SIG)
    expect(rec.sender_kind).toBeNull()
    expect(rec.sender_id).toBeNull()
    expect(rec.sender_label).toBeNull()
    expect(rec.sender_role).toBeNull()
  })

  it('drops the forged name, which is the half an attacker actually writes', async () => {
    const whole = await capture(REAL_ADVERT)
    expect(whole.sender_label).toBe('NL-OV-ENS-ESNODE')
    const forged = await capture(FORGED_NAME)
    expect(forged.sender_label).toBeNull()
    expect(forged.rssi).toBe(-97)
  })

  // Kept deliberately: raw is the only evidence that a forgery came through,
  // it is what every other row carries, and nothing renders it as a name.
  it('keeps the raw packet as evidence', async () => {
    const rec = await capture(BROKEN_SIG)
    expect(rec.raw).toBe(BROKEN_SIG)
  })

  // The failure nothing on screen would reveal: verification throwing rather
  // than returning false. It fails closed either way, and after this change
  // that costs the identity instead of every advert reception.
  it('still stores the reception when verification throws', async () => {
    vi.spyOn(MeshCoreDecoder, 'decodeWithVerification').mockRejectedValue(new Error('decoder regression'))
    expect(await verifyAdvertSignature(REAL_ADVERT)).toBe(false)
    const rec = await capture(REAL_ADVERT)
    expect(rec).not.toBeNull()
    expect(rec.rssi).toBe(-97)
    expect(rec.sender_id).toBeNull()
  })
})

describe('a packet that does not decode is still a measurement (#454 class 5)', () => {
  it('stores the RF measurement for a packet the decoder throws on', async () => {
    expect(decodePacket('zz')).toBeNull()
    const rec = await capture('zz')
    expect(rec).not.toBeNull()
    expect(rec.rssi).toBe(-97)
    expect(rec.snr).toBe(-4.25)
    expect(rec.lat).toBe(51.5)
  })

  it('stores one the decoder rejects as structurally unsound', async () => {
    const rec = await capture('ff')
    expect(rec.packet_type).toBe('Unknown')
    expect(rec.rssi).toBe(-97)
  })

  it('files it under its own type rather than the decoder placeholder', async () => {
    const rec = await capture('zz')
    expect(rec.packet_type).toBe('Unknown')
    expect(rec.sender_id).toBeNull()
    expect(rec.is_direct).toBe(false)
  })
})
