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

// Pushes a callout below any box it would cover — a sibling callout already
// placed, or the centre panel. Several controls can sit within a few dozen
// pixels of each other (the website's toolbar is one wrapping strip; the app's
// FAB stack is taller than the gap to its glass panel), so boxes anchored to
// them land on top of one another and the text underneath is unreadable.
//
// `blockers` are {top,left,width,height} — DOMRects work as-is.
export function avoidOverlap(rect, blockers, viewport, gap = 8, margin = 8) {
  let top = rect.top
  const { left, width, height } = rect
  // Blockers can chain (moved under A, now hitting B) and are not sorted, so a
  // single sweep can leave the box on one it already passed. Re-check until a
  // pass moves nothing; bounded, since every move is downward.
  for (let pass = 0; pass <= blockers.length; pass++) {
    let moved = false
    for (const b of blockers) {
      const hit = left < b.left + b.width && left + width > b.left
        && top < b.top + b.height && top + height > b.top
      if (hit) { top = b.top + b.height + gap; moved = true }
    }
    if (!moved) break
  }
  return { top: Math.min(top, viewport.height - height - margin), left }
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
