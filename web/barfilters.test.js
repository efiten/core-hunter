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
    expect(activeFilterCount({ directOnly: true, senderUnknown: true })).toBe(2)
    expect(activeFilterCount({
      directOnly: true, senderUnknown: true,
      types: new Set(['advert']), idClasses: new Set(['pubkey']),
      csAdverts: true, csRelays: true, nodePos: true,
    })).toBe(7)
  })
  // The layer mode is a view choice, not a filter: Clear never resets it, so
  // a count that included it would promise a clear that does not happen.
  it('ignores the layer mode and anything else it does not know', () => {
    expect(activeFilterCount({ mode: 'both' })).toBe(0)
    expect(activeFilterCount({ sender: 'abc', hunters: ['h1'], from: 'now-6h' })).toBe(0)
  })
})
