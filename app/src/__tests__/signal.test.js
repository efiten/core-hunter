import { describe, it, expect } from 'vitest'
import { snrTier, tierColorVar, fillOpacity, rssiTier, effectivePlotOffset, ageFade, heatWeight, extrusionHeight , withAlpha } from '../signal.js'

describe('heatWeight — RSSI → 0.05..1 Locate heatmap weight', () => {
  it('maps the strong end to 1 and clamps above', () => {
    expect(heatWeight(-70)).toBe(1)
    expect(heatWeight(-40)).toBe(1)
  })
  it('scales linearly across the band', () => {
    expect(heatWeight(-92.5)).toBeCloseTo(0.5)   // midpoint of [-115,-70]
  })
  it('floors weak/absent signal at 0.05', () => {
    expect(heatWeight(-115)).toBeCloseTo(0.05)   // (−115+115)/45 = 0 → floor
    expect(heatWeight(-140)).toBe(0.05)
  })
})

describe('thermal signal tiers (hot = strong)', () => {
  it('maps SNR to tiers', () => {
    expect(snrTier(0)).toBe('hot')
    expect(snrTier(-3)).toBe('warm')
    expect(snrTier(-7)).toBe('mid')
    expect(snrTier(-12)).toBe('cool')
    expect(snrTier(-20)).toBe('cold')
    expect(snrTier(null)).toBe('none')
  })
  it('exposes css var + opacity per tier', () => {
    expect(tierColorVar('hot')).toBe('--ch-sig-hot')
    expect(fillOpacity('hot')).toBeGreaterThan(fillOpacity('cold'))
    expect(fillOpacity('none')).toBeLessThan(fillOpacity('cool'))
  })
})

describe('rssiTier — fixed dBm bands (hot = strong = close)', () => {
  it('maps RSSI dBm to tiers', () => {
    expect(rssiTier(-70)).toBe('hot')
    expect(rssiTier(-85)).toBe('warm')
    expect(rssiTier(-95)).toBe('mid')
    expect(rssiTier(-105)).toBe('cool')
    expect(rssiTier(-120)).toBe('cold')
    expect(rssiTier(null)).toBe('none')
  })
  it('applies calibration offset before banding', () => {
    // -92 + 5 = -87 → warm
    expect(rssiTier(-92, 5)).toBe('warm')
  })
})

describe('extrusionHeight — RSSI tier → 3D hex-bar height (metres)', () => {
  it('is taller for a stronger (hotter) tier', () => {
    expect(extrusionHeight(-70)).toBeGreaterThan(extrusionHeight(-85))
    expect(extrusionHeight(-85)).toBeGreaterThan(extrusionHeight(-95))
    expect(extrusionHeight(-95)).toBeGreaterThan(extrusionHeight(-105))
    expect(extrusionHeight(-105)).toBeGreaterThan(extrusionHeight(-120))
  })
  it('is 0 for a cell with no RSSI reading', () => {
    expect(extrusionHeight(null)).toBe(0)
  })
  it('applies the calibration offset before banding, same as rssiTier', () => {
    // -92 + 5 = -87 → warm, same height as a direct -87 reading
    expect(extrusionHeight(-92, 5)).toBe(extrusionHeight(-87))
  })
})

describe('effectivePlotOffset — calibration + attenuator added back', () => {
  it('adds the attenuation magnitude back (a −20 dB attenuator → +20)', () => {
    expect(effectivePlotOffset(0, -20)).toBe(20)
    expect(effectivePlotOffset(0, -10)).toBe(10)
    expect(effectivePlotOffset(0, -30)).toBe(30)
  })
  it('stacks on top of the device calibration offset', () => {
    expect(effectivePlotOffset(5, -20)).toBe(25)
    expect(effectivePlotOffset(-3, -10)).toBe(7)
  })
  it('is a no-op at 0 dB and defaults missing args to 0', () => {
    expect(effectivePlotOffset(0, 0)).toBe(0)
    expect(effectivePlotOffset()).toBe(0)
    expect(effectivePlotOffset(8)).toBe(8)
  })
})

describe('ageFade — point opacity multiplier by age within the time window', () => {
  const now = Date.parse('2026-06-29T10:10:00Z')
  const WINDOW = 600000 // 10 min

  it('is 1 for a brand-new reception', () => {
    expect(ageFade('2026-06-29T10:10:00Z', now, WINDOW)).toBe(1)
  })
  it('fades linearly to the 0.15 floor at the window edge', () => {
    expect(ageFade('2026-06-29T10:05:00Z', now, WINDOW)).toBeCloseTo(0.575) // half-window
    expect(ageFade('2026-06-29T10:00:00Z', now, WINDOW)).toBeCloseTo(0.15) // full window
  })
  it('clamps: never below the floor, never above 1', () => {
    expect(ageFade('2026-06-29T09:00:00Z', now, WINDOW)).toBeCloseTo(0.15) // way past the window
    expect(ageFade('2026-06-29T10:11:00Z', now, WINDOW)).toBe(1)           // clock skew: rx_at in the future
  })
  it('is 1 when no time window is active or rx_at is unusable', () => {
    expect(ageFade('2026-06-29T10:00:00Z', now, null)).toBe(1)
    expect(ageFade(null, now, WINDOW)).toBe(1)
    expect(ageFade('not-a-date', now, WINDOW)).toBe(1)
  })
})

describe('withAlpha — pillars carry fade in the colour (#302)', () => {
  it('converts a 6-digit hex token to rgba', () => {
    expect(withAlpha('#ff453a', 0.5)).toBe('rgba(255,69,58,0.5)')
  })
  it('expands 3-digit shorthand', () => {
    expect(withAlpha('#f00', 1)).toBe('rgba(255,0,0,1)')
  })
  it('clamps out-of-range alpha rather than emitting an invalid colour', () => {
    expect(withAlpha('#ff453a', 2)).toBe('rgba(255,69,58,1)')
    expect(withAlpha('#ff453a', -1)).toBe('rgba(255,69,58,0)')
  })
  it('rounds long alphas so the feature property stays compact', () => {
    // fillOpacity x ageFade produces values like 0.5399999999999999.
    expect(withAlpha('#ff453a', 0.5399999999999999)).toBe('rgba(255,69,58,0.54)')
  })
  it('passes through a colour it cannot parse instead of guessing', () => {
    // A token already in rgb()/rgba() form degrades to "no fade", not to an
    // invalid paint value that would drop the whole layer.
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
    expect(withAlpha('', 0.5)).toBe('')
  })
  it('tolerates whitespace around the token, as getPropertyValue returns it', () => {
    expect(withAlpha('  #ff453a  ', 0.25)).toBe('rgba(255,69,58,0.25)')
  })
})
