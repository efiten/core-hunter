import { describe, it, expect } from 'vitest'
import { placePopover } from './multiselect.js'
import { POPOVER_MARGIN, POPOVER_GAP } from './popoverPosition.js'

// placePopover writes viewport coordinates. Whether they LAND as viewport
// coordinates depends on the panel's containing block, and that is engine
// dependent: #bar carries backdrop-filter, which per Filter Effects 2 makes it
// the containing block for its fixed descendants. Chromium applies that rule
// (popover.spec.js measures it), and it happens not to matter there because
// #bar's padding box starts at the viewport origin. WebKit is the engine we
// cannot measure in CI, and #372 is specifically a phone bug.
//
// So these tests do not assume a frame. They drive placePopover through a fake
// panel whose rect is offset from what was written — exactly what a shifted
// containing block does — and assert the panel ENDS UP at the intended viewport
// position anyway. A build without the delta correction fails them.

const VIEWPORT = { width: 412, height: 915 }

// frameOffset models the containing block: a written `left` of L renders at
// L + frameOffset.x. {0,0} is Chromium-with-#bar-at-origin; anything else is
// the case this exists for.
function fakePanel({ width, height, frameOffset = { x: 0, y: 0 } }) {
  const style = { left: '', top: '' }
  return {
    style,
    getBoundingClientRect() {
      const written = { x: parseFloat(style.left), y: parseFloat(style.top) }
      // Before the first write there is no position yet; report size only, at
      // the origin, which is what a freshly-unhidden panel looks like.
      const x = Number.isFinite(written.x) ? written.x + frameOffset.x : 0
      const y = Number.isFinite(written.y) ? written.y + frameOffset.y : 0
      return { left: x, top: y, right: x + width, bottom: y + height, width, height }
    },
    // where this panel actually renders, in viewport coordinates
    renderedLeft() { return parseFloat(style.left) + frameOffset.x },
    renderedTop() { return parseFloat(style.top) + frameOffset.y },
  }
}

const toggle = (left, top, w = 60, h = 30) => ({
  getBoundingClientRect: () =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }),
})

// The viewport is injected rather than read from window: there is no jsdom in
// web/ (vitest runs in node), and adding one to unit-test six lines of glue
// would be the wrong trade. Production call sites omit it and get window.
const place = (t, p, align) => placePopover(t, p, { align, viewport: VIEWPORT })

describe('placePopover — lands at viewport coordinates in any frame', () => {
  // The baseline: frame and viewport coincide, as they do in Chromium today.
  it('places a left-aligned panel under its toggle when the frame is the viewport', () => {
    const panel = fakePanel({ width: 240, height: 300 })
    place(toggle(20, 40), panel, 'left')
    expect(panel.renderedLeft()).toBe(20)
    expect(panel.renderedTop()).toBe(40 + 30 + POPOVER_GAP)
  })

  // The case the correction exists for: a containing block offset from the
  // viewport origin. Without the read-back the panel lands 12/8 px out — and on
  // a bar with real padding or a border, further.
  it('still lands at the intended viewport position when the frame is offset', () => {
    const plain = fakePanel({ width: 240, height: 300 })
    place(toggle(20, 40), plain, 'left')
    const intendedLeft = plain.renderedLeft(), intendedTop = plain.renderedTop()

    const shifted = fakePanel({ width: 240, height: 300, frameOffset: { x: 12, y: 8 } })
    place(toggle(20, 40), shifted, 'left')
    expect(shifted.renderedLeft()).toBe(intendedLeft)
    expect(shifted.renderedTop()).toBe(intendedTop)
    // and it got there by writing a different value, not by luck
    expect(parseFloat(shifted.style.left)).toBe(intendedLeft - 12)
  })

  // The reported bug (#372): a wide panel whose right-aligned position runs off
  // the left edge. The clamp must still hold in an offset frame — a correction
  // applied to an unclamped position would be worse than none.
  it('keeps a clamped panel on screen in an offset frame', () => {
    const shifted = fakePanel({ width: 388, height: 420, frameOffset: { x: 12, y: 8 } })
    place(toggle(81, 40), shifted, 'right')
    expect(shifted.renderedLeft()).toBeGreaterThanOrEqual(POPOVER_MARGIN)
    expect(shifted.renderedLeft() + 388).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('corrects a negative frame offset too', () => {
    const shifted = fakePanel({ width: 240, height: 300, frameOffset: { x: -30, y: -15 } })
    place(toggle(120, 40), shifted, 'left')
    expect(shifted.renderedLeft()).toBe(120)
    expect(shifted.renderedTop()).toBe(40 + 30 + POPOVER_GAP)
  })

  // Subpixel rects are normal (fractional device pixel ratios, zoom). The
  // correction must not fire on rounding noise, or every open writes twice.
  it('does not correct for subpixel noise', () => {
    const panel = fakePanel({ width: 240, height: 300, frameOffset: { x: 0.2, y: 0.2 } })
    place(toggle(20, 40), panel, 'left')
    expect(parseFloat(panel.style.left)).toBe(20)
  })
})
