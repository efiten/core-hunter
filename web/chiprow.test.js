import { describe, it, expect } from 'vitest'
import { nextChipSelection, hiddenChipCount, ALL } from './chiprow.js'

// One rule for every chip row on both surfaces (#564). "Everything" has exactly
// one representation: the All chip lit and nothing else. The app already worked
// this way (#475); the map wrote the same state as *nothing selected*, which
// nothing on screen said.

const S = (...v) => new Set(v)

describe('nextChipSelection', () => {
  it('starts at All, which is the empty selection', () => {
    expect(nextChipSelection(S(), ALL)).toEqual(S())
  })

  it('picking a chip turns All off', () => {
    expect(nextChipSelection(S(), 'advert')).toEqual(S('advert'))
  })

  it('picking a second chip adds to the first', () => {
    expect(nextChipSelection(S('advert'), 'channel')).toEqual(S('advert', 'channel'))
  })

  it('unpicking the last chip falls back to All', () => {
    // Not to "nothing shown": an empty result would be a filter nobody asked
    // for, and it is the state the map used to write for "everything".
    expect(nextChipSelection(S('advert'), 'advert')).toEqual(S())
  })

  it('unpicking one of several leaves the rest', () => {
    expect(nextChipSelection(S('advert', 'channel'), 'advert')).toEqual(S('channel'))
  })

  it('All clears everything else', () => {
    expect(nextChipSelection(S('advert', 'channel'), ALL)).toEqual(S())
  })

  it('All while already showing all is a no-op, not a toggle', () => {
    // A press that empties the view is worse than a press that does nothing,
    // and a control must not offer what would break the screen.
    expect(nextChipSelection(S(), ALL)).toEqual(S())
  })

  it('does not mutate the set it was given', () => {
    const before = S('advert')
    nextChipSelection(before, 'channel')
    expect(before).toEqual(S('advert'))
  })

  it('takes any iterable, since the two surfaces store this differently', () => {
    // The map reads its selection out of the DOM as an array; the app keeps a
    // Set on state.filter. Both call this.
    expect(nextChipSelection(['advert'], 'channel')).toEqual(S('advert', 'channel'))
    expect(nextChipSelection(null, 'advert')).toEqual(S('advert'))
  })
})

describe('hiddenChipCount', () => {
  const TYPES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  it('hides everything past the cap when nothing is picked', () => {
    expect(hiddenChipCount(TYPES, new Set(), 6)).toBe(2)
  })

  it('counts nothing when the list is short enough', () => {
    expect(hiddenChipCount(['a', 'b'], new Set(), 6)).toBe(0)
  })

  it('an active chip past the cap always shows, so it is not counted', () => {
    // The rule the map's CSS already encodes as :nth-child(n+7):not(.active) --
    // a filter that is on and off screen is the failure the panel prevents.
    expect(hiddenChipCount(TYPES, new Set(['h']), 6)).toBe(1)
    expect(hiddenChipCount(TYPES, new Set(['g', 'h']), 6)).toBe(0)
  })

  it('an active chip inside the cap changes nothing', () => {
    expect(hiddenChipCount(TYPES, new Set(['a']), 6)).toBe(2)
  })

  it('survives the empty and absent cases', () => {
    expect(hiddenChipCount([], null, 6)).toBe(0)
    expect(hiddenChipCount(null, null, 6)).toBe(0)
  })
})
