import { describe, it, expect } from 'vitest'
import { nextFocus, focusableIn } from './focustrap.js'

// Plain objects: nextFocus is deliberately DOM-free so the wrap-around and the
// direction can be pinned without a browser (there is no jsdom here). The e2e
// in ui.spec.js drives the real Tab key.
const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }

describe('nextFocus', () => {
  it('leaves the middle of the list to the browser', () => {
    // Only the two ends need intervening on. Returning an element for every
    // press would re-implement tab order, and get it wrong the first time the
    // DOM order and the tab order differ.
    expect(nextFocus([a, b, c], b)).toBe(null)
    expect(nextFocus([a, b, c], b, true)).toBe(null)
  })

  it('wraps forward off the last element', () => {
    expect(nextFocus([a, b, c], c)).toBe(a)
  })

  it('wraps backward off the first', () => {
    expect(nextFocus([a, b, c], a, true)).toBe(c)
    // ...and not forward off it, which is the direction bug this catches.
    expect(nextFocus([a, b, c], a)).toBe(null)
  })

  it('pulls focus back in when it is somewhere else entirely', () => {
    // document.body after a scrim click, or an element that has just been
    // hidden by a tab switch. Without this the trap does nothing for exactly
    // the reader who has already fallen out of the dialog.
    expect(nextFocus([a, b, c], { id: 'outside' })).toBe(a)
    expect(nextFocus([a, b, c], { id: 'outside' }, true)).toBe(c)
    expect(nextFocus([a, b, c], null)).toBe(a)
  })

  it('has nothing to say about a dialog with nothing focusable in it', () => {
    expect(nextFocus([], a)).toBe(null)
    expect(nextFocus(undefined, a)).toBe(null)
  })
})

describe('focusableIn', () => {
  // The sheet is tabbed, so two of its three panels are `hidden` whenever it is
  // open. Their buttons still match the selector, so filtering by what is
  // actually rendered is what stops Tab entering a panel nobody can see.
  const el = (name, rendered) => ({ name, offsetParent: rendered ? {} : null })
  const root = (...els) => ({ querySelectorAll: () => els })

  it('keeps only what is rendered', () => {
    const shown = el('close', true)
    const inHiddenPanel = el('about-link', false)
    expect(focusableIn(root(shown, inHiddenPanel))).toEqual([shown])
  })

  it('survives having no root at all', () => {
    expect(focusableIn(null)).toEqual([])
  })
})
