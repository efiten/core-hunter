// Where the map notices sit, given where the receptions ticker is (#630).
//
// #630 put the notices at the top centre and the ticker's first visit in the
// top left. At 1280 the ticker is 680px from the left edge and a centred 560px
// column starts at 360, so the two shared a strip under the bar, and the notice
// (z 625, over the ticker's 620) took the clicks meant for the ticker's close
// and fold buttons. A guest notice cannot be dismissed, so a guest could not
// put the ticker away at all. The ticker drags, so no fixed position clears it.
//
// Pure so the geometry can be tested without a browser: map.js measures.

// The column's widest, the stylesheet's own cap, for a band beside the ticker.
export const NOTICE_MAX_W = 560
// Air between the column and the ticker, the rail or the screen edge.
export const NOTICE_GAP = 12
// Narrower than this and a notice reads three words a line: dropping under the
// ticker reads better than squeezing in beside it.
export const NOTICE_MIN_W = 320

// `column` ({ left, width, top, height }) is the column as the stylesheet lays
// it out, centred and clear of the rail: that is the one kept when no band is
// used, so the rule for clearing the rail lives in one place, style.css.
// `ticker` is the card's box, or null while it is away. `railLeft` is the FAB
// rail's left edge, the right-hand limit of a band beside a ticker on the left.
export function noticesPlacement({ vw, column, railLeft, ticker }) {
  const { top, height, width } = column
  const centred = { left: column.left, width, top }
  if (!ticker) return centred
  const overlaps = ticker.left < centred.left + width && ticker.right > centred.left &&
    ticker.top < top + height && ticker.bottom > top
  if (!overlaps) return centred

  // "Between the ticker and the rail", as the issue asks: the band on the far
  // side of the ticker, still under the bar.
  const tickerOnTheLeft = ticker.left + ticker.right <= vw
  const bandLeft = tickerOnTheLeft ? ticker.right + NOTICE_GAP : NOTICE_GAP
  const bandRight = tickerOnTheLeft ? railLeft - NOTICE_GAP : ticker.left - NOTICE_GAP
  const band = bandRight - bandLeft
  if (band >= NOTICE_MIN_W) {
    const w = Math.min(NOTICE_MAX_W, band)
    return { left: bandLeft + (band - w) / 2, width: w, top }
  }
  // Under the whole card rather than its header: the rows take clicks too.
  return { ...centred, top: ticker.bottom + NOTICE_GAP }
}
