import { describe, it, expect } from 'vitest'
import { snrTier, tierColorVar, fillOpacity, rssiTier } from './signal.js'
import {
  snrTier as appSnrTier,
  tierColorVar as appTierColorVar,
  fillOpacity as appFillOpacity,
  rssiTier as appRssiTier,
} from '../app/src/signal.js'

const TIERS = ['hot', 'warm', 'mid', 'cool', 'cold', 'faint', 'none']

// This module is a hand-kept subset of the app's (the two are merged by #238);
// until then these assertions are the only thing keeping them from drifting,
// and a drift shows up as the same reception rendering in two different
// colours on the map and in the app.
describe('signal — parity with app/src/signal.js', () => {
  it('bands RSSI identically across the whole scale', () => {
    for (let rssi = -130; rssi <= -20; rssi++) {
      expect(rssiTier(rssi)).toBe(appRssiTier(rssi))
    }
    expect(rssiTier(null)).toBe(appRssiTier(null))
  })
  it('applies the calibration offset identically', () => {
    expect(rssiTier(-120, 8)).toBe(appRssiTier(-120, 8))
  })
  it('bands SNR identically', () => {
    for (let snr = -20; snr <= 10; snr++) {
      expect(snrTier(snr)).toBe(appSnrTier(snr))
    }
  })
  it('resolves the same colour token and opacity per tier', () => {
    for (const t of TIERS) {
      expect(tierColorVar(t)).toBe(appTierColorVar(t))
      expect(fillOpacity(t)).toBe(appFillOpacity(t))
    }
  })
})

describe('rssiTier — weak end below -110 (#282)', () => {
  it('separates the sub -110 fringe into cold and faint', () => {
    expect(rssiTier(-105)).toBe('cool')
    expect(rssiTier(-112)).toBe('cold')
    expect(rssiTier(-120)).toBe('faint')
  })
})
