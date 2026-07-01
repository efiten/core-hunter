import { describe, it, expect } from 'vitest'
import { splashState, SPLASH_COPY, SPLASH_DISCLAIMER, SPLASH_TIPS, pickTip } from '../splash.js'

describe('splashState', () => {
  it('hides once a GPS fix has been acquired, regardless of other state', () => {
    expect(splashState({ hasFix: true, connected: false, bleError: true, gpsError: true })).toBe('hidden')
  })
  it('shows intro before connecting', () => {
    expect(splashState({ hasFix: false, connected: false, bleError: false, gpsError: false })).toBe('intro')
  })
  it('shows ble-error when the last connect attempt failed, even if previously connected', () => {
    expect(splashState({ hasFix: false, connected: false, bleError: true, gpsError: false })).toBe('ble-error')
  })
  it('shows waiting-gps once connected but no fix yet and no GPS error', () => {
    expect(splashState({ hasFix: false, connected: true, bleError: false, gpsError: false })).toBe('waiting-gps')
  })
  it('shows gps-error once connected and the GPS watch reported an error', () => {
    expect(splashState({ hasFix: false, connected: true, bleError: false, gpsError: true })).toBe('gps-error')
  })
})

describe('SPLASH_COPY', () => {
  it('has copy for every non-hidden state', () => {
    expect(Object.keys(SPLASH_COPY).sort()).toEqual(['ble-error', 'gps-error', 'intro', 'waiting-gps'])
  })
})

describe('SPLASH_DISCLAIMER', () => {
  it('states position is inferred from radio signal, not GPS tracking (AGENTS.md §7)', () => {
    expect(SPLASH_DISCLAIMER).toMatch(/inferred/i)
    expect(SPLASH_DISCLAIMER).toMatch(/RSSI|signal/i)
    expect(SPLASH_DISCLAIMER).toMatch(/not GPS/i)
  })
})

describe('SPLASH_TIPS', () => {
  it('is a non-empty list of non-empty strings', () => {
    expect(Array.isArray(SPLASH_TIPS)).toBe(true)
    expect(SPLASH_TIPS.length).toBeGreaterThan(0)
    for (const t of SPLASH_TIPS) expect(typeof t === 'string' && t.length > 0).toBe(true)
  })
})

describe('pickTip', () => {
  const tips = ['a', 'b', 'c']
  it('returns the tip at the given index', () => {
    expect(pickTip(tips, 0)).toBe('a')
    expect(pickTip(tips, 2)).toBe('c')
  })
  it('wraps around past the end (cyclic rotation)', () => {
    expect(pickTip(tips, 3)).toBe('a')
    expect(pickTip(tips, 4)).toBe('b')
  })
  it('handles negative indices with a safe modulo', () => {
    expect(pickTip(tips, -1)).toBe('c')
  })
  it('returns empty string for an empty list', () => {
    expect(pickTip([], 0)).toBe('')
  })
})
