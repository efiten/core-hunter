import { describe, it, expect } from 'vitest'
import { SOUND_MODES, nextSoundMode, harmFreq, pingGain, shouldPing, createSoundEngine } from '../sound.js'

describe('nextSoundMode', () => {
  it('cycles off → rxtx → full → off', () => {
    expect(nextSoundMode('off')).toBe('rxtx')
    expect(nextSoundMode('rxtx')).toBe('full')
    expect(nextSoundMode('full')).toBe('off')
  })
  it('falls back to off for unknown values (corrupt/pre-#255 storage)', () => {
    expect(nextSoundMode('geiger')).toBe('rxtx')
    expect(nextSoundMode(null)).toBe('rxtx')
  })
  it('exposes the three modes in cycle order', () => {
    expect(SOUND_MODES).toEqual(['off', 'rxtx', 'full'])
  })
})

describe('harmFreq — RSSI quantized to the harmonic series of F2', () => {
  const F2 = 87.31
  it('maps the weak end (-115 dBm) to the 4th harmonic (F4)', () => {
    expect(harmFreq(-115)).toBeCloseTo(F2 * 4, 5)
  })
  it('maps the strong end (-75 dBm) to the 12th harmonic (C6)', () => {
    expect(harmFreq(-75)).toBeCloseTo(F2 * 12, 5)
  })
  it('clamps outside the band', () => {
    expect(harmFreq(-140)).toBeCloseTo(harmFreq(-115), 5)
    expect(harmFreq(-20)).toBeCloseTo(harmFreq(-75), 5)
  })
  it('quantizes — nearby RSSI values land on the same harmonic', () => {
    expect(harmFreq(-96)).toBeCloseTo(harmFreq(-97), 5)
  })
  it('only produces consonant overtones of F (harmonics 4,5,6,8,9,10,12)', () => {
    const allowed = [4, 5, 6, 8, 9, 10, 12]
    for (let rssi = -120; rssi <= -70; rssi += 1) {
      const h = Math.round(harmFreq(rssi) / F2)
      expect(allowed).toContain(h)
    }
  })
  it('applies the plot offset (calibration + attenuator), same as the map', () => {
    // -105 raw with +10 offset ≡ -95 calibrated
    expect(harmFreq(-105, 10)).toBeCloseTo(harmFreq(-95), 5)
  })
  it('defaults a missing RSSI to the lowest harmonic', () => {
    expect(harmFreq(null)).toBeCloseTo(F2 * 4, 5)
    expect(harmFreq(undefined)).toBeCloseTo(F2 * 4, 5)
  })
})

describe('pingGain', () => {
  it('is quieter at the weak end than at the strong end', () => {
    expect(pingGain(-115)).toBeLessThan(pingGain(-75))
  })
  it('stays within (0, 1]', () => {
    expect(pingGain(-140)).toBeGreaterThan(0)
    expect(pingGain(-20)).toBeLessThanOrEqual(1)
  })
})

describe('shouldPing', () => {
  const pass = () => true
  const reject = () => false
  const rec = { hops: 0, rssi: -90 }
  it('pings a zero-hop reception that passes the filter in rxtx mode', () => {
    expect(shouldPing(rec, 'rxtx', pass, 0)).toBe(true)
  })
  it('pings in full mode too', () => {
    expect(shouldPing(rec, 'full', pass, 0)).toBe(true)
  })
  it('never pings when sound is off', () => {
    expect(shouldPing(rec, 'off', pass, 0)).toBe(false)
  })
  it('ignores relayed receptions — only what the hunter heard directly', () => {
    expect(shouldPing({ ...rec, hops: 2 }, 'rxtx', pass, 0)).toBe(false)
  })
  it('follows the active filter set (you hear what the map shows)', () => {
    expect(shouldPing(rec, 'rxtx', reject, 0)).toBe(false)
  })
})

describe('createSoundEngine without Web Audio (node / unsupported browser)', () => {
  it('degrades to a safe no-op engine', () => {
    const s = createSoundEngine()
    expect(() => {
      s.setMode('full')
      s.ping(-90, 0)
      s.txBlip('discover')
      s.txBlip('trace')
      s.setMode('off')
      s.destroy()
    }).not.toThrow()
  })
})
