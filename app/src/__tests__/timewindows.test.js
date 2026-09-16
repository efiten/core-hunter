import { describe, it, expect } from 'vitest'
import { TIME_WINDOWS, windowMs, widerWindowMs } from '../timewindows.js'
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

// #646: the receptions list reaches further back than the window the map
// draws, and the card offers to close that gap in one tap. Which window that
// tap picks is this: the first one on the list that would take the oldest row
// on show, so the step is the smallest one that actually helps.
describe('widerWindowMs — the first window that would include what is on show', () => {
  const MIN = 60 * 1000
  const HOUR = 60 * MIN

  it('picks the first preset that covers the oldest row', () => {
    expect(widerWindowMs(50 * MIN, 30 * MIN)).toBe(HOUR)
    expect(widerWindowMs(2 * HOUR, 30 * MIN)).toBe(3 * HOUR)
  })
  // A step to something no wider than the current window is not a step: the
  // row it was offered for would still fall outside it.
  it('never offers a window at or below the one in use', () => {
    expect(widerWindowMs(50 * MIN, HOUR)).toBeNull()
    expect(widerWindowMs(HOUR, HOUR)).toBeNull()
  })
  // Past the longest preset there is still an answer, because the app offers
  // All time under the list; null is that answer, not a failure.
  it('falls through to All time when no preset reaches far enough', () => {
    expect(widerWindowMs(9 * 24 * HOUR, 30 * MIN)).toBeNull()
  })
  it('has nothing wider to offer once the window is All time', () => {
    expect(widerWindowMs(9 * 24 * HOUR, null)).toBeNull()
  })
})
