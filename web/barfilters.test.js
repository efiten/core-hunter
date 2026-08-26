import { describe, it, expect } from 'vitest'
import { hiddenFiltersActive, DEFAULT_MODE } from './barfilters.js'

// The pill answers one question: is anything the sheet hides switched on. Each
// control has to be able to answer it alone, or the pill goes dark while a
// filter is silently on -- which is worse than no pill, because the bar then
// looks like it is showing everything.
describe('hiddenFiltersActive', () => {
  it('is quiet when nothing in the sheet is touched', () => {
    expect(hiddenFiltersActive()).toBe(false)
    expect(hiddenFiltersActive({ types: new Set() })).toBe(false)
    expect(hiddenFiltersActive({ mode: DEFAULT_MODE })).toBe(false)
  })

  it.each([
    ['direct only', { directOnly: true }],
    ['sender unknown', { senderUnknown: true }],
    ['a packet-type filter', { types: new Set(['Advert']) }],
    ['CoreScope adverts', { csAdverts: true }],
    ['CoreScope relays', { csRelays: true }],
    ['node positions', { nodePos: true }],
    ['a non-default layer mode', { mode: 'points' }],
  ])('lights on %s alone', (_label, state) => {
    expect(hiddenFiltersActive(state)).toBe(true)
  })

  // web's cold mode is hex (map.js), not the app's points. Defaulting to the
  // app's value lit the dot on an untouched map, which makes the indicator
  // worthless: always on is the same as never on.
  it('treats the cold layer mode as untouched', () => {
    expect(DEFAULT_MODE).toBe('hex')
    expect(hiddenFiltersActive({ mode: 'hex' })).toBe(false)
    expect(hiddenFiltersActive({ mode: 'both' })).toBe(true)
  })

  it('ignores the filters that stay visible in the bar', () => {
    // Hunter, sender and time-range never move into the sheet, so they must not
    // drive the pill: it would then claim something is hidden when nothing is.
    expect(hiddenFiltersActive({ sender: 'abc', hunters: ['h1'], from: 'now-6h' })).toBe(false)
  })
})
