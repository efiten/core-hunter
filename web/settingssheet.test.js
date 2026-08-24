import { describe, it, expect } from 'vitest'
import { initialSettingsTab } from './settingssheet.js'

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
