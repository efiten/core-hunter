import { describe, it, expect } from 'vitest'
import { SOUND_MODES, nextSoundMode, harmFreq, pingGain, shouldPing, createSoundEngine } from '../sound.js'
import { RSSI_WEAK_DBM, RSSI_STRONG_DBM } from '../signal.js'

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
  it('maps the weak end (-125 dBm) to the 4th harmonic (F4)', () => {
    expect(harmFreq(-125)).toBeCloseTo(F2 * 4, 5)
  })
  it('maps the strong end (-75 dBm) to the 24th harmonic (C7)', () => {
    expect(harmFreq(-75)).toBeCloseTo(F2 * 24, 5)
  })

  // #471: the step size is the coarsest thing about the instrument, and it is
  // coarsest exactly where you are closing in. Asserted as a property over the
  // whole band rather than by retyping the ladder, so it fails for the reason
  // it is about: a step you could drive through without hearing.
  it('never leaves more than 5 dB inside one step', () => {
    const seen = []
    for (let db = RSSI_WEAK_DBM; db <= RSSI_STRONG_DBM; db += 0.25) {
      const f = harmFreq(db)
      if (!seen.length || seen[seen.length - 1].f !== f) seen.push({ db, f })
    }
    const widest = seen.slice(1).reduce((w, s, i) => Math.max(w, s.db - seen[i].db), 0)
    expect(widest).toBeLessThanOrEqual(5)
  })

  // The consonance rule is "overtone of F2", not "pentatonic" -- and the
  // overtones that are NOT scale degrees are the ones that would clash: 7, 11,
  // 13 and 14 sit up to a quarter-tone between the keys.
  it('uses only overtones of the root, and none of the out-of-tune ones', () => {
    const ratios = new Set()
    for (let db = RSSI_WEAK_DBM; db <= RSSI_STRONG_DBM; db += 0.25) ratios.add(harmFreq(db) / F2)
    for (const r of ratios) {
      expect(Math.abs(r - Math.round(r))).toBeLessThan(1e-6)
      expect([7, 11, 13, 14]).not.toContain(Math.round(r))
    }
  })
  // The step size is what you actually hunt by: closing from -95 to -88 dBm
  // has to be audible as a rise, not absorbed inside one harmonic. Widening
  // the band to -125 without an eighth step would have swallowed it (#282).
  it('rises across a 7 dB gain at close range', () => {
    expect(harmFreq(-88)).toBeGreaterThan(harmFreq(-95))
  })
  // The band bottomed out at -115, so the whole sub -115 fringe pinged
  // identically — the same flattening the map had before #282.
  it('still rises across the sub -115 fringe', () => {
    expect(harmFreq(-115)).toBeGreaterThan(harmFreq(-125))
  })
  it('clamps outside the band', () => {
    expect(harmFreq(-140)).toBeCloseTo(harmFreq(-125), 5)
    expect(harmFreq(-20)).toBeCloseTo(harmFreq(-75), 5)
  })
  it('quantizes — nearby RSSI values land on the same harmonic', () => {
    expect(harmFreq(-96)).toBeCloseTo(harmFreq(-97), 5)
  })
  // Outside the band too, not just inside it: the clamp must not fall off the
  // ladder into an arbitrary multiple. (The membership check that used to live
  // here retyped the ladder itself, so it could only fail when someone edited
  // the array and forgot the test; the property test above is what pins the
  // rule.)
  it('stays on the ladder either side of the band', () => {
    for (const rssi of [-130, -128, -72, -70]) {
      const h = harmFreq(rssi) / F2
      expect(Math.abs(h - Math.round(h))).toBeLessThan(1e-6)
    }
  })
  it('applies the plot offset (calibration + attenuator), same as the map', () => {
    // -105 raw with +10 offset ≡ -95 calibrated
    expect(harmFreq(-105, 10)).toBeCloseTo(harmFreq(-95), 5)
  })
  it('takes the weak/strong anchors from signal.js, so HUD, map and ping agree', () => {
    expect(harmFreq(RSSI_WEAK_DBM)).toBeCloseTo(F2 * 4, 5)
    expect(harmFreq(RSSI_STRONG_DBM)).toBeCloseTo(F2 * 24, 5)
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
