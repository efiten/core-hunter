import { describe, it, expect } from 'vitest'
import { TIME_WINDOWS, windowMs } from '../timewindows.js'
import { DEFAULT_FILTER } from '../filters.js'
import { RETENTION_MS } from '../queue.js'

describe('windowMs', () => {
  it('resolves a token in minutes, hours or days', () => {
    expect(windowMs('5m')).toBe(5 * 60 * 1000)
    expect(windowMs('1h')).toBe(60 * 60 * 1000)
    expect(windowMs('2d')).toBe(2 * 24 * 60 * 60 * 1000)
  })
  // The app's select uses 0 for All time, so a token that does not resolve has
  // to come back as something the select cannot mistake for that.
  it('is null, not 0, for anything that is not a bare token', () => {
    for (const bad of ['now-5m', '', undefined, '30x', 'd', '5 m']) expect(windowMs(bad), String(bad)).toBeNull()
  })
})

describe('TIME_WINDOWS', () => {
  // The select is a list of durations; one out of order reads as a typo, and a
  // duplicate is two rows that do the same thing.
  it('runs from short to long without repeating', () => {
    const ms = TIME_WINDOWS.map((w) => windowMs(w.token))
    for (let i = 1; i < ms.length; i++) expect(ms[i], TIME_WINDOWS[i].token).toBeGreaterThan(ms[i - 1])
  })
  // The select opens on the default. A default the list does not offer would
  // leave it blank, and the first change would be the only way to ever see it.
  it('offers the default window', () => {
    expect(TIME_WINDOWS.map((w) => windowMs(w.token))).toContain(DEFAULT_FILTER.windowMs)
  })
  // Retention prunes at 7 days (#230), so a longer window would promise data
  // the store no longer holds. This is why the map's 30 days does not port.
  it('never reaches past retention', () => {
    for (const w of TIME_WINDOWS) expect(windowMs(w.token), w.token).toBeLessThanOrEqual(RETENTION_MS)
  })
})
