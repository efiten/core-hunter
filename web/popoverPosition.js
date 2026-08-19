// Places a bar popover (the time-range picker, the sender and hunter pickers)
// so that all of it stays on screen, whatever the toggle's position (#372).
//
// CSS cannot do this: `right: 0` / `left: 0` anchor the panel to the toggle's
// containing block, and #bar wraps, so on a phone #tr-toggle sits at the LEFT
// of its own row and a right-anchored 400px panel grows off the screen. What is
// visible is the panel's own padding, which reads as an empty dark box.
//
// The order is the standard popover one (flip, then shift):
//   1. place at the preferred alignment
//   2. if it overflows, flip to the other alignment
//   3. if that overflows too, shift it back inside and keep the alignment lost
// Step 3 is the case a flip-only fix misses: a toggle in the middle of a narrow
// screen overflows in both directions, so neither alignment can be honoured.
// Same for the vertical axis: below the toggle, else above it, else clamped.

export const POPOVER_MARGIN = 12
// Matches the `top: calc(100% + 4px)` the panels used before this was computed.
export const POPOVER_GAP = 4

function fits(start, size, limit, margin) {
  return start >= margin && start + size <= limit - margin
}

// toggleRect: {left,right,top,bottom} (a DOMRect works as-is).
// panelSize: {width,height}. viewport: {width,height}.
// opts.align: 'right' (panel's right edge on the toggle's, growing left) |
//             'left'  (panel's left edge on the toggle's, growing right).
export function popoverPosition(toggleRect, panelSize, viewport, opts = {}) {
  const margin = opts.margin ?? POPOVER_MARGIN
  const gap = opts.gap ?? POPOVER_GAP
  const { width, height } = panelSize

  const alignRight = toggleRect.right - width
  const alignLeft = toggleRect.left
  const preferred = opts.align === 'left' ? alignLeft : alignRight
  const flipped = opts.align === 'left' ? alignRight : alignLeft

  let left = preferred
  if (!fits(left, width, viewport.width, margin)) {
    // Neither alignment fits: shift the preferred one back inside by the
    // smallest amount. The left margin wins when the panel is wider than the
    // viewport, because that edge carries the labels and the first field.
    left = fits(flipped, width, viewport.width, margin)
      ? flipped
      : Math.max(margin, Math.min(preferred, viewport.width - margin - width))
  }

  const below = toggleRect.bottom + gap
  const above = toggleRect.top - gap - height
  let top = below
  if (!fits(top, height, viewport.height, margin)) {
    top = fits(above, height, viewport.height, margin) ? above : Math.max(margin, above)
  }

  return { left, top }
}
