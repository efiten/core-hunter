import { describe, it, expect } from 'vitest'
import { skyForHour, SKY_STOPS, DARK_MAX_LUMA } from '../sky.js'

// Independent of the implementation's own helper on purpose: if the test read
// luminance through the same function the cap uses, a wrong coefficient would
// cancel out and the cap assertions below would pass for the wrong reason.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const luma = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

const stopAt = (h) => SKY_STOPS.find((s) => s.h === h)

describe('skyForHour — time of day', () => {
  it('returns a stop exactly at its own hour', () => {
    const day = stopAt(14)
    const sky = skyForHour(14, 'light')
    expect(sky['sky-color']).toBe(day.sky)
    expect(sky['horizon-color']).toBe(day.horizon)
    expect(sky['fog-color']).toBe(day.fog)
  })

  // Halfway between two stops must land halfway between their colours, per
  // channel. Deliberately the dawn->sunrise pair (5.5 -> 7): its channels move
  // by 43/81/112, so snapping to either neighbour misses by tens. The 10->14
  // pair would not discriminate — its green channels are 134 and 135, so
  // snapping and interpolating agree to within a rounding step.
  it('interpolates between stops rather than snapping to one', () => {
    const a = stopAt(5.5), b = stopAt(7)
    const mid = skyForHour(6.25, 'light')['sky-color']
    const [ar, ag, ab] = rgb(a.sky), [br, bg, bb] = rgb(b.sky), [mr, mg, mb] = rgb(mid)
    expect(Math.abs(mr - (ar + br) / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(mg - (ag + bg) / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(mb - (ab + bb) / 2)).toBeLessThanOrEqual(0.5)
    // and it is genuinely between, not equal to either end
    expect(mid).not.toBe(a.sky)
    expect(mid).not.toBe(b.sky)
  })

  it('wraps the clock, so 25:00 is 01:00 and -01:00 is 23:00', () => {
    expect(skyForHour(25, 'light')).toEqual(skyForHour(1, 'light'))
    expect(skyForHour(-1, 'light')).toEqual(skyForHour(23, 'light'))
  })

  it('is continuous across midnight — the 0 and 24 stops match', () => {
    expect(skyForHour(0, 'light')).toEqual(skyForHour(24, 'light'))
  })

  it('carries the blend constants the sky needs to read as a horizon', () => {
    const sky = skyForHour(14, 'light')
    expect(sky['sky-horizon-blend']).toBeGreaterThan(0)
    expect(sky['horizon-fog-blend']).toBeGreaterThan(0)
    expect(typeof sky['fog-ground-blend']).toBe('number')
  })

  it('never returns a malformed colour, at any hour', () => {
    for (let h = 0; h <= 24; h += 0.25) {
      for (const theme of ['dark', 'light']) {
        for (const key of ['sky-color', 'horizon-color', 'fog-color']) {
          expect(skyForHour(h, theme)[key]).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })
})

describe('skyForHour — dark theme caps brightness', () => {
  // The whole point of the cap: a bright midday sky above a dark basemap.
  it('darkens a midday sky on the dark theme', () => {
    const light = skyForHour(14, 'light')
    const dark = skyForHour(14, 'dark')
    expect(luma(dark['sky-color'])).toBeLessThan(luma(light['sky-color']))
    expect(luma(dark['horizon-color'])).toBeLessThan(luma(light['horizon-color']))
  })

  it('holds every daylight colour at or under the cap', () => {
    for (let h = 6; h <= 20; h += 0.5) {
      const sky = skyForHour(h, 'dark')
      for (const key of ['sky-color', 'horizon-color', 'fog-color']) {
        expect(luma(sky[key])).toBeLessThanOrEqual(DARK_MAX_LUMA + 0.5)
      }
    }
  })

  // Night is already below the cap, so capping must be a no-op there — a cap
  // that darkened everything would make the night sky black-on-black.
  it('leaves a night sky untouched, since it is already under the cap', () => {
    expect(skyForHour(0, 'dark')).toEqual(skyForHour(0, 'light'))
    expect(skyForHour(3, 'dark')).toEqual(skyForHour(3, 'light'))
  })

  it('keeps the hue when it darkens, rather than washing to grey', () => {
    const dark = skyForHour(14, 'dark')['sky-color']
    const [r, g, b] = rgb(dark)
    // the day sky is blue: blue stays the dominant channel after capping
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('treats an unknown theme as light, so a bad token cannot black out the sky', () => {
    expect(skyForHour(14, 'sepia')).toEqual(skyForHour(14, 'light'))
    expect(skyForHour(14, '')).toEqual(skyForHour(14, 'light'))
  })
})
