import { describe, it, expect } from 'vitest'
import { nextStyleAttempt, STYLE_RETRY_MS } from '../basemapswap.js'

// #626. A theme switch calls setStyle and then has to mount the signal overlays
// on the new style. Which moment that is was measured against the bundled
// MapLibre 4.7.1, in the browser, with a style whose sources never answer —
// the case the issue is actually about:
//
//   - 'style.load' does not fire on setStyle at all.
//   - Immediately after setStyle, isStyleLoaded() is still true, for the OLD
//     style. Anything checking it there reads the wrong answer.
//   - Exactly one 'styledata' fires, at +23..31 ms, with isStyleLoaded() false.
//   - isStyleLoaded() then never goes true (polled 12 s) and 'idle' never
//     fires, because both wait on the sources rather than on the style.
//   - addSource/addLayer at that 'styledata' moment succeed, and the layers are
//     still there three seconds later.
//
// So the overlays mount on 'styledata' without waiting for tiles, and the old
// 'idle' hook is what left the map bare for twelve seconds on a slow link.
describe('nextStyleAttempt — what the safety net does when the style never arrives', () => {
  // Kasper's call: keep the timer, but try the hosted style once more before
  // giving up on it. Dropping straight to a flat background threw away a
  // basemap that was usually only slow.
  it('retries the hosted style the first time', () => {
    expect(nextStyleAttempt(0)).toBe('retry')
  })

  it('falls back to the bare background once the retry has also failed', () => {
    expect(nextStyleAttempt(1)).toBe('bare')
  })

  // The bare style needs no network, so a third attempt would be a loop that
  // re-swaps the map forever on a dead connection.
  it('stays bare after that rather than cycling', () => {
    for (const n of [2, 3, 10]) expect(nextStyleAttempt(n), String(n)).toBe('bare')
  })

  it('treats a missing or nonsense count as the first attempt', () => {
    for (const n of [undefined, null, -1, NaN]) expect(nextStyleAttempt(n), String(n)).toBe('retry')
  })

  it('waits long enough to be a safety net rather than a race', () => {
    expect(STYLE_RETRY_MS).toBeGreaterThanOrEqual(5000)
  })
})

// The second half of #626 — the over/under drawing — is a declared LAYER_ORDER
// in each map module plus one normalising pass at the end of addOverlays. The
// order itself is per surface (the two do not draw the same set), so it is
// pinned where it lives: see the LAYER_ORDER tests in huntmap-order.test.js.
