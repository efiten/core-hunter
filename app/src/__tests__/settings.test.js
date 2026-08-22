import { describe, it, expect, afterEach, vi } from 'vitest'
import { isSettingsActive, initialSettingsTab, loadAttenuator, loadSoundMode, loadViewIndex, loadChangelogSeen, saveChangelogSeen } from '../settings.js'

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
  // #421: the settings button's dot is the only pre-open signal there is, so
  // unread release notes have to reach it. Asserted with the attenuator at its
  // default, or the existing branch would answer for this one.
  it('is true when release notes are unread, with every setting at its default', () => {
    expect(isSettingsActive({ attenuatorDb: 0, unseenChangelog: true })).toBe(true)
  })
  it('is false when the notes have been read and nothing else is on', () => {
    expect(isSettingsActive({ attenuatorDb: 0, unseenChangelog: false })).toBe(false)
  })
})

describe('initialSettingsTab', () => {
  // Unread notes take the sheet to them once; the acknowledgement that opening
  // the tab writes is what makes the next open land back on Settings, so these
  // two cases are the whole behaviour.
  it('opens on the release notes while they are unread', () => {
    expect(initialSettingsTab({ unseenChangelog: true })).toBe('whatsnew')
  })
  it('opens on Settings once they have been read', () => {
    expect(initialSettingsTab({ unseenChangelog: false })).toBe('settings')
  })
  it('opens on Settings for missing/undefined input', () => {
    expect(initialSettingsTab({})).toBe('settings')
    expect(initialSettingsTab(undefined)).toBe('settings')
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
  // A plain object literal answers for its prototype's keys, so 'toString'
  // would come back truthy and be returned as if it were a sound mode.
  it("falls back to 'off' for a stored Object.prototype key", () => {
    for (const k of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
      vi.stubGlobal('localStorage', storageWith({ 'core-hunter-sound': k }))
      expect(loadSoundMode()).toBe('off')
    }
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

describe('changelog seen-version (#284)', () => {
  it('returns the acknowledged version', () => {
    vi.stubGlobal('localStorage', storageWith({ 'core-hunter-changelog-seen': '1.6.0' }))
    expect(loadChangelogSeen()).toBe('1.6.0')
  })
  it('returns null when nothing was acknowledged yet', () => {
    vi.stubGlobal('localStorage', storageWith({}))
    expect(loadChangelogSeen()).toBe(null)
  })
  it('returns null instead of throwing when storage access throws', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(loadChangelogSeen()).toBe(null)
  })
  it('writes the version under the key the loader reads', () => {
    const written = {}
    vi.stubGlobal('localStorage', { getItem: (k) => written[k] ?? null, setItem: (k, v) => { written[k] = v } })
    saveChangelogSeen('1.7.0')
    expect(loadChangelogSeen()).toBe('1.7.0')
  })
  it('does not throw when storage refuses the write', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(() => saveChangelogSeen('1.7.0')).not.toThrow()
  })
})
