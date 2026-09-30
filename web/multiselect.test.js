import { describe, it, expect, afterEach } from 'vitest'
import { bulkAction, wirePopover } from './multiselect.js'

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

// #714: opening the sender picker left nothing focused, so reaching a node by
// name took a press on the field between the toggle and the first keystroke.
// web/ has no jsdom; the elements are the fakes wirePopover touches.
describe('wirePopover puts the caret in the search field (#714)', () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }
  function fakes() {
    const own = {}, doc = []
    globalThis.window = { innerWidth: 400, innerHeight: 800 }
    globalThis.document = { activeElement: null, addEventListener: (type, fn) => doc.push({ type, fn }) }
    const focus = (el) => (opts) => { el.focusedWith = opts || {}; globalThis.document.activeElement = el }
    const toggleEl = { setAttribute() {}, addEventListener: (type, fn) => { own[type] = fn }, getBoundingClientRect: () => rect }
    toggleEl.focus = focus(toggleEl)
    const field = { value: 'ab12' }
    field.focus = focus(field)
    const panelEl = { hidden: true, style: {}, getBoundingClientRect: () => rect, contains: (el) => el === field }
    const popover = wirePopover({ toggleEl, panelEl, wrapEl: {}, wrapSelector: '.ms-wrap', focusEl: field })
    const key = (k) => {
      const e = { key: k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
      doc.filter((l) => l.type === 'keydown').forEach((l) => l.fn(e))
      return e
    }
    return { toggleEl, panelEl, field, popover, press: () => own.click(), key }
  }
  afterEach(() => { delete globalThis.window; delete globalThis.document })

  it('focuses the field on open, without scrolling the page, and keeps what it holds', () => {
    const f = fakes()
    f.press()
    expect(f.panelEl.hidden).toBe(false)
    expect(globalThis.document.activeElement).toBe(f.field)
    expect(f.field.focusedWith).toEqual({ preventScroll: true })
    // On web the field is the sender filter itself, bound to ?sender=.
    expect(f.field.value).toBe('ab12')
  })

  it('hands focus back to the toggle when it closes with the caret inside', () => {
    const f = fakes()
    f.press()
    const e = f.key('Escape')
    expect(f.panelEl.hidden).toBe(true)
    expect(globalThis.document.activeElement).toBe(f.toggleEl)
    // The browser's own Escape in a search field clears it: a changed filter.
    expect(e.defaultPrevented).toBe(true)
    expect(f.field.value).toBe('ab12')
  })

  it('leaves focus alone when it closes with the focus elsewhere', () => {
    const f = fakes()
    f.press()
    const elsewhere = {}
    globalThis.document.activeElement = elsewhere
    f.press()
    expect(globalThis.document.activeElement).toBe(elsewhere)
  })
})
