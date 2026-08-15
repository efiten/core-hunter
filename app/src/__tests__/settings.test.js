import { describe, it, expect, afterEach, vi } from 'vitest'
import { isSettingsActive, loadAttenuator, loadSoundMode, loadViewIndex } from '../settings.js'

// A storage stub whose getItem throws, standing in for the contexts where
// localStorage access raises SecurityError (Safari with cookies blocked, a
// WebView with storage disabled, some private-browsing modes) — #338.
function throwingStorage() {
  return { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('SecurityError') } }
}

function storageWith(map) {
  return { getItem: (k) => (k in map ? map[k] : null), setItem() {} }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('isSettingsActive', () => {
  it('is false when attenuator is 0', () => {
    expect(isSettingsActive({ attenuatorDb: 0 })).toBe(false)
  })
  it('is true when the attenuator is non-zero', () => {
    expect(isSettingsActive({ attenuatorDb: -10 })).toBe(true)
  })
  it('is false for missing/undefined input', () => {
    expect(isSettingsActive({})).toBe(false)
    expect(isSettingsActive(undefined)).toBe(false)
  })
})

describe('loadAttenuator', () => {
  it('returns the stored attenuation when it is one of the offered steps', () => {
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-attenuator': '-20' }))
    expect(loadAttenuator()).toBe(-20)
  })
  it('falls back to 0 for a missing or corrupt value', () => {
    vi.stubGlobal('localStorage', storageWith({}))
    expect(loadAttenuator()).toBe(0)
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-attenuator': 'boom' }))
    expect(loadAttenuator()).toBe(0)
  })
  it('returns 0 instead of throwing when storage access throws', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(loadAttenuator()).toBe(0)
  })
})

describe('loadSoundMode', () => {
  it('returns a stored known mode', () => {
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-sound': 'full' }))
    expect(loadSoundMode()).toBe('full')
  })
  it('migrates the pre-#255 4-state values onto the 3-state set', () => {
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-sound': 'ping' }))
    expect(loadSoundMode()).toBe('rxtx')
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-sound': 'ambient' }))
    expect(loadSoundMode()).toBe('full')
  })
  it("falls back to 'off' for a missing or unknown value", () => {
    vi.stubGlobal('localStorage', storageWith({}))
    expect(loadSoundMode()).toBe('off')
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-sound': 'siren' }))
    expect(loadSoundMode()).toBe('off')
  })
  it("returns 'off' instead of throwing when storage access throws", () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(loadSoundMode()).toBe('off')
  })
})

describe('loadViewIndex', () => {
  it('returns the index of the stored view state', () => {
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-view': 'points2d' }))
    expect(loadViewIndex()).toBe(0)
  })
  it('falls back to both/2D (index 1) for a missing or unknown value', () => {
    vi.stubGlobal('localStorage', storageWith({}))
    expect(loadViewIndex()).toBe(1)
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-view': 'hex4d' }))
    expect(loadViewIndex()).toBe(1)
  })
  it('returns 1 instead of throwing when storage access throws', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(loadViewIndex()).toBe(1)
  })
})
