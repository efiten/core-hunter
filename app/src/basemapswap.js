// The theme swap (#626). setStyle drops every overlay, so the signal layers
// have to be mounted again on the new style. Which moment that is was measured
// against the bundled MapLibre 4.7.1, in a browser, with a style whose sources
// never answer — the case this issue is actually about:
//
//   - 'style.load' does not fire on setStyle at all.
//   - Immediately after setStyle, isStyleLoaded() is still true, for the OLD
//     style, so anything reading it there gets the previous answer.
//   - Exactly one 'styledata' fires, at +23..31 ms, with isStyleLoaded() false.
//   - isStyleLoaded() then never goes true (polled 12 s) and 'idle' never
//     fires: both wait on the sources, not on the style document.
//   - addSource/addLayer at that 'styledata' moment succeed, and the layers are
//     still on the map three seconds later.
//
// So the overlays mount on 'styledata' and do not wait for tiles. 'idle' was
// the old hook, and waiting there for tiles it could not get is what left the
// map on a flat background for twelve seconds.
//
// Copied byte-for-byte into app/src/ and web/ (web/parity.test.js pins it):
// neither deploy path can ship a file outside its own directory, and both
// surfaces swap their basemap the same way.

// How long the safety net waits before deciding the style is not coming.
// Unchanged from the timer it replaces: it is a net, not a race.
export const STYLE_RETRY_MS = 12000

// What that timer does when it fires. The hosted style gets one more chance
// before the map gives up on it, because a style that was merely slow used to
// be discarded for the rest of the session. Past that the bare background
// stands and nothing re-swaps: it needs no network, so a further attempt would
// be a loop rather than a recovery.
export function nextStyleAttempt(attempt) {
  return Number.isFinite(attempt) && attempt >= 1 ? 'bare' : 'retry'
}

// The layer order is declared per surface (the two do not draw the same set)
// and applied by moving each present layer to the top in declared order — see
// LAYER_ORDER in huntmap.js and mapcore.js. That needs no helper here, so
// there is none: the stack is data, and one loop applies it.
