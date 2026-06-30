import { describe, it, expect } from 'vitest'
import { haversineM, rssiWeight, weightedCentroid } from './locate.js'

describe('haversineM', () => {
  it('is ~0 for identical points', () => {
    expect(haversineM({ lat: 51, lon: 4 }, { lat: 51, lon: 4 })).toBeCloseTo(0, 5)
  })
  it('matches a known ~111.2 km per degree of latitude', () => {
    const d = haversineM({ lat: 51, lon: 4 }, { lat: 52, lon: 4 })
    expect(d).toBeGreaterThan(111000)
    expect(d).toBeLessThan(111400)
  })
})

describe('rssiWeight', () => {
  it('clamps weak to 0 and strong to 1', () => {
    expect(rssiWeight(-130)).toBe(0)
    expect(rssiWeight(-30)).toBe(1)
  })
  it('is 0.5 at the midpoint (-80 dBm)', () => {
    expect(rssiWeight(-80)).toBeCloseTo(0.5, 6)
  })
  it('returns 0 for null/NaN', () => {
    expect(rssiWeight(null)).toBe(0)
    expect(rssiWeight(NaN)).toBe(0)
  })
})

describe('weightedCentroid', () => {
  it('is the midpoint for two equal-RSSI points', () => {
    const c = weightedCentroid([
      { lat: 0, lon: 0, rssi: -80 },
      { lat: 2, lon: 4, rssi: -80 },
    ])
    expect(c.lat).toBeCloseTo(1, 6)
    expect(c.lon).toBeCloseTo(2, 6)
  })
  it('is pulled toward the stronger point', () => {
    const c = weightedCentroid([
      { lat: 0, lon: 0, rssi: -40 }, // weight 1
      { lat: 10, lon: 0, rssi: -80 }, // weight 0.5
    ])
    // (1*0 + 0.5*10)/1.5 = 3.333...
    expect(c.lat).toBeCloseTo(10 / 3, 5)
  })
  it('returns null when all weights are 0', () => {
    expect(weightedCentroid([{ lat: 1, lon: 1, rssi: -130 }])).toBeNull()
  })
})
