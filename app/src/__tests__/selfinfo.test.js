import { describe, it, expect } from 'vitest'
import { parseSelfInfo, radioSummary } from '../selfinfo.js'

const hexToBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)))

// Real SELF_INFO capture from a Heltec V4.3 companion running on SF7.
// Radio params sit at a fixed offset before the variable-length name:
// [48..51] freq kHz, [52..55] bw Hz, [56] spreading factor, [57] coding rate.
const SF7 =
  '050116166718d3a1b0c9c0e9be0b1bd9fa9707dec0741a4575b598d4c101341c56714f96860a1703ba16590001000101f2440d0024f4000007086b6173'

describe('parseSelfInfo — spreading factor (byte 56)', () => {
  it('reads SF7 from a real companion capture', () => {
    expect(parseSelfInfo(hexToBytes(SF7)).sf).toBe(7)
  })

  it('reads other SF values at the same offset', () => {
    const b = hexToBytes(SF7)
    b[56] = 8
    expect(parseSelfInfo(b).sf).toBe(8)
    b[56] = 12
    expect(parseSelfInfo(b).sf).toBe(12)
  })

  it('treats an out-of-range SF byte as unknown (null)', () => {
    const b = hexToBytes(SF7)
    b[56] = 0
    expect(parseSelfInfo(b).sf).toBeNull()
  })

  it('returns null SF when the frame is too short to include byte 56', () => {
    expect(parseSelfInfo(hexToBytes(SF7).slice(0, 50)).sf).toBeNull()
  })

  it('still returns the pubkey and name', () => {
    const info = parseSelfInfo(hexToBytes(SF7))
    expect(info.pubkey).toHaveLength(64)
    expect(info.name).toBe('kas')
  })

  it('returns null for a frame too short to parse at all', () => {
    expect(parseSelfInfo(hexToBytes('0501'))).toBeNull()
  })
})

// #650: the frame carries the whole radio, not only the SF. Firmware
// examples/companion_radio/MyMesh.cpp (CMD_APP_START handler): after byte 47,
// `freq = _prefs.freq * 1000` as uint32 LE (kHz), `bw = _prefs.bw * 1000` as
// uint32 LE (Hz), then sf, then cr. Each range-checked against the firmware's
// own clamps, so a short or older frame leaves it null rather than guessed.
describe('parseSelfInfo — frequency, bandwidth and coding rate (#650)', () => {
  it('reads the four radio values from the real capture', () => {
    expect(parseSelfInfo(hexToBytes(SF7))).toMatchObject({ freqKhz: 869618, bwHz: 62500, sf: 7, cr: 8 })
  })
  it('reads another preset at the same offsets', () => {
    const b = hexToBytes(SF7)
    new DataView(b.buffer).setUint32(48, 868000, true)
    new DataView(b.buffer).setUint32(52, 125000, true)
    b[57] = 5
    expect(parseSelfInfo(b)).toMatchObject({ freqKhz: 868000, bwHz: 125000, cr: 5 })
  })
  it('takes what the firmware can be set to: a 2.4 GHz radio, and a narrow bandwidth as the float sends it', () => {
    const b = hexToBytes(SF7)
    new DataView(b.buffer).setUint32(48, 2400000, true)
    new DataView(b.buffer).setUint32(52, 10399, true)   // 10.4f * 1000, truncated
    expect(parseSelfInfo(b)).toMatchObject({ freqKhz: 2400000, bwHz: 10399 })
  })
  it('leaves a value outside the firmware clamps as null, and the others alone', () => {
    const b = hexToBytes(SF7)
    new DataView(b.buffer).setUint32(52, 5000, true)    // under 7.8 kHz
    b[57] = 4                                           // coding rate is 4/5 to 4/8
    const info = parseSelfInfo(b)
    expect(info.bwHz).toBeNull()
    expect(info.cr).toBeNull()
    expect(info.freqKhz).toBe(869618)
    expect(info.sf).toBe(7)
    const f = hexToBytes(SF7)
    new DataView(f.buffer).setUint32(48, 0, true)
    expect(parseSelfInfo(f).freqKhz).toBeNull()
    new DataView(f.buffer).setUint32(48, 2600000, true)
    expect(parseSelfInfo(f).freqKhz).toBeNull()
  })
  it('leaves every radio value null on a frame too short to carry it, and still connects', () => {
    const info = parseSelfInfo(hexToBytes(SF7).slice(0, 50))
    expect(info).toMatchObject({ freqKhz: null, bwHz: null, sf: null, cr: null })
    expect(info.pubkey).toHaveLength(64)
    expect(parseSelfInfo(hexToBytes(SF7).slice(0, 56))).toMatchObject({ freqKhz: 869618, bwHz: 62500, sf: null, cr: null })
  })
})

// The Status tab's one line for the radio: what the companion reports, in the
// units a hunter reads, and only what it reports.
describe('radioSummary', () => {
  it('prints the four values the way a hunter reads them', () => {
    expect(radioSummary({ sf: 7, freqKhz: 869618, bwHz: 62500, cr: 8 })).toBe('SF7 · 869.618 MHz · 62.5 kHz · CR 4/8')
  })
  it('leaves out what the frame did not carry, and is a dash with nothing', () => {
    expect(radioSummary({ sf: 8, freqKhz: null, bwHz: null, cr: null })).toBe('SF8')
    expect(radioSummary({ sf: null, freqKhz: 868000, bwHz: 125000, cr: 5 })).toBe('868 MHz · 125 kHz · CR 4/5')
    expect(radioSummary({})).toBe('—')
    expect(radioSummary(null)).toBe('—')
  })
})
