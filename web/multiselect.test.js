import { describe, it, expect } from 'vitest'
import { bulkAction } from './multiselect.js'

// #628. The control above a picker's list is one button, and its label is what
// a tap does. The rest of the picker is DOM and lives in e2e/hunterpicker.spec.js.
describe('bulkAction', () => {
  it('offers to select all when nothing is picked', () => {
    expect(bulkAction(0)).toEqual({ action: 'all', label: 'Select all' })
  })
  it('offers to clear as soon as anything is picked, a partial pick included', () => {
    expect(bulkAction(1)).toEqual({ action: 'clear', label: 'Clear selection' })
    expect(bulkAction(30)).toEqual({ action: 'clear', label: 'Clear selection' })
  })
})
