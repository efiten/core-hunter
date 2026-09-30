import { describe, it, expect } from 'vitest'
import { createTargetList } from '../targetlist.js'

// #714. The target chip opened the sheet and focused nothing, so reaching a
// node by name took a press on the field between the chip and the first
// keystroke. And reset() reset paging only: reopening the sheet brought back
// the last query and a list narrowed by it, with nothing on screen saying why.
// No jsdom in this suite; the elements are the fakes the list touches.
function fakes(query) {
  const listEl = { scrollTop: 0, children: [], addEventListener() {}, replaceChildren(...c) { this.children = c } }
  const searchEl = { value: query, focusedWith: null, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn }, focus(opts) { this.focusedWith = opts || {} } }
  const browseEl = { hidden: false }
  const list = createTargetList(listEl, { searchEl, browseEl })
  return { list, listEl, searchEl, browseEl }
}

describe('opening the target sheet (#714)', () => {
  it('puts the caret in the search field, without scrolling the page', () => {
    const f = fakes('')
    f.list.open()
    expect(f.searchEl.focusedWith).toEqual({ preventScroll: true })
  })

  it('starts from an empty query every time, and repaints at once', () => {
    // A query that matches nothing paints the "No senders match." row, which
    // is the one element render builds with no rows at all.
    globalThis.document = { createElement: () => ({ className: '', textContent: '' }) }
    try {
      const f = fakes('dikke')
      f.list.render([], new Set(), Date.now(), null)
      expect(f.listEl.children).toHaveLength(1)
      // A query hides the browse chrome (Top and the list header).
      expect(f.browseEl.hidden).toBe(true)
      f.list.open()
      expect(f.searchEl.value).toBe('')
      expect(f.listEl.children).toHaveLength(0)
      // What a user sees come back: the browse chrome, with the query gone.
      expect(f.browseEl.hidden).toBe(false)
    } finally { delete globalThis.document }
  })
})
