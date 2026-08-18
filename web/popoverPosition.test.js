import { describe, it, expect } from 'vitest'
import { popoverPosition, POPOVER_MARGIN, POPOVER_GAP } from './popoverPosition.js'

// A toggle button somewhere in the bar, and a panel of a given size. Sizes are
// the real ones: .tr-panel is ~416px of max-content, .tl-panel is a fixed 240.
const toggle = (left, width = 96, top = 26, height = 24) =>
  ({ left, right: left + width, top, bottom: top + height, width, height })
const panel = (width, height = 300) => ({ width, height })
const phone = { width: 412, height: 915 }
const desktop = { width: 1280, height: 720 }

describe('popoverPosition', () => {
  it('right-aligns the panel to the toggle when that fits', () => {
    // The preferred alignment, and the one the CSS used to hardcode: the panel's
    // right edge on the toggle's right edge, growing leftwards.
    const { left, top } = popoverPosition(toggle(600), panel(416), desktop, { align: 'right' })
    expect(left).toBe(600 + 96 - 416)
    expect(top).toBe(50 + POPOVER_GAP)
  })

  it('left-aligns when asked, which is what the pickers want', () => {
    expect(popoverPosition(toggle(600), panel(240), desktop, { align: 'left' }).left).toBe(600)
  })

  // #372: the bar wraps on a phone, so #tr-toggle lands at the LEFT of its own
  // row. Right-aligning a 416px panel to a toggle at x=45 puts its content at
  // x=-275, off the screen, and the visible strip is the panel's own padding.
  it('flips a right-aligned panel that would run off the left edge', () => {
    // Right-aligned is 45 + 96 - 300 = -159. Left-aligned ends at 345, inside
    // the 400px content box, so the flip is taken and nothing is clamped.
    const { left } = popoverPosition(toggle(45), panel(300), phone, { align: 'right' })
    expect(left).toBe(45)
  })

  it('flips a left-aligned panel that would run off the right edge', () => {
    // Toggle near the right edge: growing rightwards overflows, so align right.
    const { left } = popoverPosition(toggle(300, 80), panel(240), phone, { align: 'left' })
    expect(left).toBe(300 + 80 - 240)
  })

  // The flip is a preference, not a guarantee: a toggle in the middle of a
  // narrow screen overflows in BOTH directions, so the panel has to be shifted
  // rather than aligned to either edge. This is the case a flip-only fix misses.
  it('shifts a panel that overflows whichever edge it is aligned to', () => {
    // Toggle hard against the right edge: right-aligned is 110 and overruns the
    // right margin, left-aligned overruns further. Neither alignment survives,
    // so it is shifted to 100 — the last spot inside. A flip-only fix leaves it
    // at 110 with 10px of the panel under the edge.
    const { left } = popoverPosition(toggle(380, 30), panel(300), phone, { align: 'right' })
    expect(left).toBe(phone.width - POPOVER_MARGIN - 300)
    expect(left).toBeGreaterThan(POPOVER_MARGIN)
  })

  it('pins a panel wider than the viewport to the left margin instead of centring the overflow', () => {
    // Nothing fits. Losing the left edge loses the labels and the first field,
    // so the margin wins and the overflow goes right, where the shift clamp in
    // the caller (max-width) will have already narrowed it.
    expect(popoverPosition(toggle(100), panel(600), phone, { align: 'right' }).left).toBe(POPOVER_MARGIN)
  })

  it('opens below the toggle, and flips above it when there is no room below', () => {
    const low = toggle(600, 96, 880, 24)
    const { top } = popoverPosition(low, panel(240, 300), phone, { align: 'left' })
    expect(top).toBe(880 - POPOVER_GAP - 300)
  })

  it('clamps to the top margin rather than going negative when neither side fits', () => {
    // Panel taller than the viewport: above would be negative, below would run
    // off the bottom. The top of the content is what has to stay reachable.
    const { top } = popoverPosition(toggle(600, 96, 400, 24), panel(240, 1000), phone, { align: 'left' })
    expect(top).toBe(POPOVER_MARGIN)
  })

  it('is pure: it does not mutate the rects it is given', () => {
    const t = toggle(45)
    const p = panel(388)
    const snapshot = JSON.stringify([t, p])
    popoverPosition(t, p, phone, { align: 'right' })
    expect(JSON.stringify([t, p])).toBe(snapshot)
  })
})
