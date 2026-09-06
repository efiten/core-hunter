import { describe, it, expect } from 'vitest'
import * as webSignal from './signal.js'
import * as appSignal from '../app/src/signal.js'
import { snrTier, tierColorVar, fillOpacity, rssiTier } from './signal.js'
import {
  snrTier as appSnrTier,
  tierColorVar as appTierColorVar,
  fillOpacity as appFillOpacity,
  rssiTier as appRssiTier,
} from '../app/src/signal.js'

const TIERS = ['hot', 'warm', 'mid', 'cool', 'cold', 'faint', 'none']

// Since #595 the web copy is the app's file whole (parity.test.js pins the
// bytes); these assertions stay as the function-level reading of the same
// promise, since a drift shows up as the same reception rendering in two
// different colours on the map and in the app.
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
  // The fallback is the one value a per-tier sweep cannot reach, so it is
  // exactly where the two copies can drift unnoticed.
  it('falls back to the same opacity for an unknown tier', () => {
    expect(fillOpacity('nonsense')).toBe(appFillOpacity('nonsense'))
    expect(fillOpacity(undefined)).toBe(appFillOpacity(undefined))
  })
  // Structural guard (#238 option 2), the other way round since #595: the
  // web copy is the app's file whole, so the two export the same set. The
  // bytes are pinned in parity.test.js; this reads the same promise at the
  // module surface, so a copy that stops being one fails on both.
  it('exports the same set as the app module', () => {
    expect(Object.keys(webSignal).sort()).toEqual(Object.keys(appSignal).sort())
  })
})

describe('rssiTier — weak end below -110 (#282)', () => {
  it('separates the sub -110 fringe into cold and faint', () => {
    expect(rssiTier(-105)).toBe('cool')
    expect(rssiTier(-112)).toBe('cold')
    expect(rssiTier(-120)).toBe('faint')
  })
})
