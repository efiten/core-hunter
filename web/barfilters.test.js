import { describe, it, expect } from 'vitest'
import { activeFilterCount } from './barfilters.js'

// The pill says "Filters (N)" and the clear button "Clear N filters"; both
// read this count. Dimensions, not chips: four active type chips are one
// narrowed dimension, and clearing it is one act.
describe('activeFilterCount', () => {
  it('is 0 on a untouched map, whatever shape the empty inputs take', () => {
    expect(activeFilterCount()).toBe(0)
    expect(activeFilterCount({ types: new Set(), idClasses: [] })).toBe(0)
  })
  it('counts each narrowed dimension once, not each chip', () => {
    expect(activeFilterCount({ types: new Set(['advert', 'trace', 'request', 'ack']) })).toBe(1)
    expect(activeFilterCount({ idClasses: ['pubkey', '1byte'] })).toBe(1)
  })
  it('adds the checkboxes and layers up dimension by dimension', () => {
    expect(activeFilterCount({ directOnly: true, nodePos: true })).toBe(2)
    expect(activeFilterCount({
      directOnly: true,
      types: new Set(['advert']), idClasses: new Set(['pubkey']),
      csAdverts: true, csRelays: true, nodePos: true,
    })).toBe(6)
  })
  // #535: Sender unknown was the Unnamed chip under another name, so it is
  // not a dimension any more; a caller still passing it counts nothing.
  it('does not count a Sender-unknown flag', () => {
    expect(activeFilterCount({ directOnly: true, senderUnknown: true })).toBe(1)
  })
  // The layer mode is a view choice, not a filter: Clear never resets it, so
  // a count that included it would promise a clear that does not happen.
  it('ignores the layer mode and anything else it does not know', () => {
    expect(activeFilterCount({ mode: 'both' })).toBe(0)
    expect(activeFilterCount({ sender: 'abc', hunters: ['h1'], from: 'now-6h' })).toBe(0)
  })
})

// The app's own dimension, added when one function started answering for both
// panels (#564). The map's timeframe is a bar control that travels in the URL,
// so it is deliberately not here for either surface -- Clear has never reset it.
describe('activeFilterCount, the app half', () => {
  it('counts the plot window as one dimension', () => {
    expect(activeFilterCount({ window: true })).toBe(1)
    expect(activeFilterCount({ window: false })).toBe(0)
  })

  it('adds up with the dimensions both surfaces share', () => {
    expect(activeFilterCount({ window: true, directOnly: true, types: new Set(['advert']) })).toBe(3)
  })
})
