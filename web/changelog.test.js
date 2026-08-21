import { describe, it, expect } from 'vitest'
import { whereLabel, hasUnseenEntries, unseenEntryCount, migratedSeenId } from './changelog.js'

// Entries as changelog.json actually ships them: newest first, one per change a
// user could notice, written in plain language with no scope prefix and no
// issue number. Ids are date-prefixed slugs, which is what makes "newer than
// what you acknowledged" a position in the list rather than a comparison.
const ENTRIES = [
  { id: '2026-08-21-c', date: '2026-08-21', where: 'map', title: 'C', body: 'c' },
  { id: '2026-08-20-b', date: '2026-08-20', where: 'both', title: 'B', body: 'b' },
  { id: '2026-08-19-a', date: '2026-08-19', where: 'app', title: 'A', body: 'a' },
]

describe('whereLabel', () => {
  it('names the surface an entry applies to', () => {
    expect(whereLabel('app')).toBe('App')
    expect(whereLabel('map')).toBe('Map')
    expect(whereLabel('both')).toBe('App and map')
  })
  // The file is hand-written, so a typo must cost the label, not the panel.
  it('is empty for a value it does not know, rather than throwing', () => {
    for (const v of ['', undefined, null, 'nonsense']) expect(whereLabel(v), String(v)).toBe('')
  })
})

describe('unseenEntryCount', () => {
  it('counts the entries published above the acknowledged one', () => {
    expect(unseenEntryCount(ENTRIES, '2026-08-19-a')).toBe(2)
    expect(unseenEntryCount(ENTRIES, '2026-08-20-b')).toBe(1)
    expect(unseenEntryCount(ENTRIES, '2026-08-21-c')).toBe(0)
  })
  // Nothing acknowledged means a first run, which is deliberately silent —
  // marking every entry new would announce a history the reader was never
  // here for.
  it('is 0 when nothing was acknowledged', () => {
    expect(unseenEntryCount(ENTRIES, null)).toBe(0)
    expect(unseenEntryCount(ENTRIES, '')).toBe(0)
  })
  // An id that is not in the file any more (an entry was edited or dropped)
  // has no position to count from, and guessing one marks everything new.
  it('is 0 for an acknowledged id the file no longer contains', () => {
    expect(unseenEntryCount(ENTRIES, 'gone')).toBe(0)
  })
  it('is 0 for an empty or missing file', () => {
    expect(unseenEntryCount([], 'x')).toBe(0)
    expect(unseenEntryCount(undefined, 'x')).toBe(0)
  })
  // The file is hand-written, so an entry can ship without an id. Without the
  // explicit guard on the acknowledgement, a first run (seenId null/undefined)
  // matches that entry by === and reports a position, which would mark the
  // entries above it new to a reader who has never been here.
  it('is 0 on a first run even when an entry is missing its id', () => {
    // Below the newest entry on purpose: an id-less entry at the top would
    // match at index 0, and index 0 counts as 0 anyway, so the fixture would
    // pass whether the guard is there or not.
    const malformed = [ENTRIES[0], { date: '2026-08-20', title: 'no id' }, ...ENTRIES.slice(1)]
    expect(unseenEntryCount(malformed, undefined)).toBe(0)
    expect(unseenEntryCount(malformed, null)).toBe(0)
    expect(unseenEntryCount(malformed, '')).toBe(0)
  })
})

describe('hasUnseenEntries', () => {
  it('is true while the newest entry is not the acknowledged one', () => {
    expect(hasUnseenEntries(ENTRIES, '2026-08-20-b')).toBe(true)
  })
  it('is false once the newest entry has been acknowledged', () => {
    expect(hasUnseenEntries(ENTRIES, '2026-08-21-c')).toBe(false)
  })
  it('is false on a first run and for an empty file', () => {
    expect(hasUnseenEntries(ENTRIES, null)).toBe(false)
    expect(hasUnseenEntries([], null)).toBe(false)
  })
  // The one case where this and unseenEntryCount deliberately disagree: an
  // acknowledged id that has fallen out of the file is not "up to date", so
  // the dot shows -- but there is no position to count from, so nothing is
  // marked new. The reader sees a dot and an unmarked list, which is honest.
  // Defining this as `count > 0` would silently drop the dot instead.
  it('still shows the dot for an acknowledged id the file no longer contains', () => {
    expect(hasUnseenEntries(ENTRIES, 'gone')).toBe(true)
    expect(unseenEntryCount(ENTRIES, 'gone')).toBe(0)
  })
})

describe('migratedSeenId', () => {
  const newest = '2026-08-21-c'
  it('leaves an existing entry-id acknowledgement alone', () => {
    expect(migratedSeenId('2026-08-19-a', '1.9.0', newest)).toBe('2026-08-19-a')
  })
  // The distinction this function exists for. A reader who acknowledged under
  // the old version-string scheme has been here before, so the curated notes
  // are genuinely new to them: return null, which stores nothing and leaves
  // the dot showing until they open the panel.
  it('gives a reader from the old scheme the dot exactly once', () => {
    expect(migratedSeenId(null, '1.9.0', newest)).toBe('1.9.0')
  })

  // The composition, which is where this first went wrong: testing the
  // migration and the badge separately hid that "store nothing" reads as a
  // first visit, and a first visit is deliberately silent -- so the dot the
  // migration exists to raise never appeared. Assert the state they produce
  // together, not each in isolation.
  it('lands a migrated reader in the state that shows a dot over an unmarked list', () => {
    const migrated = migratedSeenId(null, '1.9.0', newest)
    expect(hasUnseenEntries(ENTRIES, migrated)).toBe(true)
    expect(unseenEntryCount(ENTRIES, migrated)).toBe(0)
  })

  it('leaves a first-time reader silent, by the same composition', () => {
    const migrated = migratedSeenId(null, null, newest)
    expect(hasUnseenEntries(ENTRIES, migrated)).toBe(false)
    expect(unseenEntryCount(ENTRIES, migrated)).toBe(0)
  })
  // Someone who has never acknowledged anything is a first-time visitor, and
  // the panel has always been silent for them.
  it('stays silent for a reader who has never acknowledged anything', () => {
    expect(migratedSeenId(null, null, newest)).toBe(newest)
    expect(migratedSeenId(null, '', newest)).toBe(newest)
  })
})
