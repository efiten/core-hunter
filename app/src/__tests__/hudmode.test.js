import { describe, it, expect } from 'vitest'
import { hudShows, hiddenAfter, hudToggleText, hudActions } from '../hudmode.js'

const advert = { sender_kind: 'advert_pubkey', sender_id: 'AB12CD34EF56', sender_label: 'alpha' }

describe('hudShows', () => {
  it('shows every reception in all mode, whatever the filter says', () => {
    expect(hudShows('all', false)).toBe(true)
    expect(hudShows('all', true)).toBe(true)
  })
  it('shows only receptions the filter lets through in filtered mode', () => {
    expect(hudShows('filtered', true)).toBe(true)
    expect(hudShows('filtered', false)).toBe(false)
  })
  // makeFilter answers a boolean; anything else is a caller bug, and "shown"
  // is the wrong side to fail on when the mode says filtered.
  it('treats a missing verdict as not matching', () => {
    expect(hudShows('filtered', undefined)).toBe(false)
  })
})

describe('hiddenAfter', () => {
  // The count is "since the shown reception", so a shown one resets it and
  // a hidden one adds to it.
  it('counts receptions kept off the HUD, and resets when one is shown', () => {
    let n = 0
    n = hiddenAfter(n, { mode: 'filtered', matches: false })
    n = hiddenAfter(n, { mode: 'filtered', matches: false })
    expect(n).toBe(2)
    n = hiddenAfter(n, { mode: 'filtered', matches: true })
    expect(n).toBe(0)
  })
  it('is always 0 in all mode, since nothing is kept off the HUD', () => {
    expect(hiddenAfter(5, { mode: 'all', matches: false })).toBe(0)
  })
})

describe('hudToggleText', () => {
  it('names the mode on the button', () => {
    expect(hudToggleText('filtered', 0).label).toBe('Filtered')
    expect(hudToggleText('all', 0).label).toBe('All')
  })
  // The closed eye is the one visible sign that the filter is keeping
  // something off the HUD; the count itself lives in the aria-label and the
  // tooltip only.
  it('shows the closed eye only while filtered mode is hiding something', () => {
    expect(hudToggleText('filtered', 0).eye).toBe(false)
    expect(hudToggleText('filtered', 3).eye).toBe(true)
    expect(hudToggleText('all', 3).eye).toBe(false)
  })
  it('says what the eye means, with the count, for assistive tech', () => {
    const t = hudToggleText('filtered', 3)
    expect(t.aria).toBe('HUD shows filtered receptions, 3 hidden since this one')
    expect(t.title).toBe('3 receptions outside the filter since this one')
    expect(hudToggleText('filtered', 1).aria).toBe('HUD shows filtered receptions, 1 hidden since this one')
    expect(hudToggleText('filtered', 0).aria).toBe('HUD shows filtered receptions')
    expect(hudToggleText('all', 0).aria).toBe('HUD shows all receptions')
  })
})

describe('hudActions', () => {
  const none = { selected: new Set(), ignored: new Set() }

  it('offers nothing when there is no reception or no sender', () => {
    for (const rec of [null, { sender_id: null, sender_kind: 'advert_pubkey' }]) {
      const a = hudActions(rec, none)
      expect(a.target.enabled, JSON.stringify(rec)).toBe(false)
      expect(a.add.enabled).toBe(false)
      expect(a.ignore.enabled).toBe(false)
    }
  })

  it('offers all three for a sender that can be a target', () => {
    const a = hudActions(advert, none)
    expect(a.target.enabled).toBe(true)
    expect(a.add.enabled).toBe(true)
    expect(a.ignore.enabled).toBe(true)
  })

  // The same rule the target list applies (feed.js TARGET_KINDS): a 1-byte
  // hash names 256 nodes, so it cannot be a target. It can still be muted,
  // which is what the map popup offers for it too.
  it('keeps a 1-byte hash out of the target actions, but lets it be ignored', () => {
    for (const kind of ['direct_hash', 'path_hash']) {
      const a = hudActions({ sender_kind: kind, sender_id: '4a', sender_label: '4a' }, none)
      expect(a.target.enabled, kind).toBe(false)
      expect(a.add.enabled, kind).toBe(false)
      expect(a.ignore.enabled, kind).toBe(true)
    }
  })

  it('marks the target actions active while the sender is selected, case-insensitively', () => {
    const a = hudActions(advert, { selected: new Set(['ab12cd34ef56']), ignored: new Set() })
    expect(a.target.active).toBe(true)
    expect(a.add.active).toBe(true)
    expect(hudActions(advert, none).target.active).toBe(false)
  })

  it('marks ignore active, and says so, while the sender is on the ignore list', () => {
    const a = hudActions(advert, { selected: new Set(), ignored: new Set(['ab12cd34ef56']) })
    expect(a.ignore.active).toBe(true)
    expect(a.ignore.label).toBe('Ignored')
    expect(hudActions(advert, none).ignore.label).toBe('Ignore')
  })
})
