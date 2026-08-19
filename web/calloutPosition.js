// Positions an onboarding spotlight callout relative to the actual target
// element it points at, instead of a hardcoded pixel offset (#216) — so it
// stays correctly placed across screen sizes.
//
// Duplicated as app/src/calloutPosition.js and web/calloutPosition.js — the two
// deploy paths cannot share a file (see web/parity.test.js), which also pins the
// copies together. Keep them byte-identical.

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(value, hi))
}

// targetRect/calloutSize are plain {left,top,right,bottom}/{width,height} —
// pass DOMRect-likes (e.g. from getBoundingClientRect()) or plain objects.
// opts.side: 'below' (default) | 'above' | 'left' | 'right'.
// opts.align: 'left' (default) | 'right' — only applies to 'below'/'above'.
export function calloutPosition(targetRect, viewport, calloutSize, opts = {}) {
  const gap = opts.gap ?? 10
  const margin = opts.margin ?? 8
  const side = opts.side || 'below'

  let top
  if (side === 'above') top = targetRect.top - gap - calloutSize.height
  else if (side === 'below') top = targetRect.bottom + gap
  else top = targetRect.top

  let left
  if (side === 'left') left = targetRect.left - gap - calloutSize.width
  else if (side === 'right') left = targetRect.right + gap
  else left = opts.align === 'right' ? targetRect.right - calloutSize.width : targetRect.left

  return {
    top: clamp(top, margin, viewport.height - calloutSize.height - margin),
    left: clamp(left, margin, viewport.width - calloutSize.width - margin),
  }
}

// Does this rect overlap any of the blockers? Exported because a caller that
// cannot place a box clear of them needs to know — the spotlight falls back to
// listing its copy in the panel rather than drawing boxes over it.
export function overlapsAny(rect, blockers) {
  return blockers.some((b) => rect.left < b.left + b.width && rect.left + rect.width > b.left
    && rect.top < b.top + b.height && rect.top + rect.height > b.top)
}

// Moves a callout clear of any box it would cover — a sibling callout already
// placed, or the centre panel. Several controls can sit within a few dozen
// pixels of each other (the website's toolbar is one wrapping strip; the app's
// FAB stack is taller than the gap to its glass panel), so boxes anchored to
// them land on top of one another and the text underneath is unreadable.
//
// Tries below first, then above. Going only downward and clamping to the
// viewport at the end puts the box back on the blocker it just cleared whenever
// the bottom is close — the clamp does not know what it is clamping into.
// When neither direction has room the anchored position is returned unchanged
// (clamped on screen): a box that overlaps where it belongs beats one parked
// somewhere arbitrary, and `overlapsAny` lets the caller detect the case and
// stop drawing boxes altogether.
//
// `blockers` are {top,left,width,height} — DOMRects work as-is.
export function avoidOverlap(rect, blockers, viewport, gap = 8, margin = 8) {
  const { left, width, height } = rect
  const at = (top) => ({ top, left, width, height })
  const fits = (top) => top >= margin && top + height <= viewport.height - margin
  // Blockers can chain (moved past A, now hitting B) and are not sorted, so a
  // single sweep can leave the box on one it already passed. Re-check until a
  // pass moves nothing; bounded, since every move is in the same direction.
  const settle = (down) => {
    let top = rect.top
    for (let pass = 0; pass <= blockers.length; pass++) {
      let moved = false
      for (const b of blockers) {
        if (!overlapsAny(at(top), [b])) continue
        top = down ? b.top + b.height + gap : b.top - gap - height
        moved = true
      }
      if (!moved) break
    }
    return top
  }
  for (const down of [true, false]) {
    const top = settle(down)
    if (fits(top) && !overlapsAny(at(top), blockers)) return { top, left }
  }
  return { top: Math.max(margin, Math.min(rect.top, viewport.height - height - margin)), left }
}

// Bounding box enclosing every given rect — used to anchor one callout to a
// cluster of target elements (e.g. the FAB stack) rather than a single one.
export function unionRect(rects) {
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
