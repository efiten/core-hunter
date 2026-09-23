// Segmented progress ring for multi-state FABs (#259): N equal arcs around the
// button, filled (accent) from the first segment through the current one, the
// rest muted — so a tap's effect (advancing to the next segment) is visible at
// a glance, not just inferable from the icon changing. Used by the layer FAB
// (5 views), the compass FAB (2 stops), the sound FAB (off/rxtx/full) and
// the node-positions FAB (off/positions/reach), and on the map by its rail's
// node-positions button (#630), which is why web/fabring.js is this file byte
// for byte (web/parity.test.js).
// Two-state plain toggles like 2D/3D don't need it — a single on/off doesn't
// benefit from a "1 of 2" indicator.

const RADIUS = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 4 // px gap between segments, in SVG user units

// Pure geometry: one entry per segment, in draw order. `filled` = segments
// from 0 through `current` (inclusive) — a genuine progress fill, not just a
// single active-segment marker.
//
// offIndex names the one state, if any, that is *off* rather than at position
// zero (#373): at that index nothing is filled, because off is the absence of
// a progress position and a lit segment there reads as active while the
// feature is doing nothing. Off is not a segment either (#620): the ring counts
// the on states, so off / positions / reach draws two segments and reads empty,
// half, full. Counting the off stop lit two thirds for the first on state. It
// is opt-in per call site, not a rule about index 0: of the FABs that use this
// ring, the sound one and node positions have an off state.
// The compass's `following` and the view FAB's `points 2D` are both *on* at
// index 0 and have no off stop, so every segment they draw is a real position.
export function ringSegments(current, total, { offIndex } = {}) {
  const hasOff = Number.isInteger(offIndex) && offIndex >= 0 && offIndex < total
  const count = hasOff ? total - 1 : total
  if (count < 2) return []
  const off = hasOff && current === offIndex
  // The position among the on states: the stops after the off one move up.
  const position = hasOff && current > offIndex ? current - 1 : current
  const segLen = (CIRCUMFERENCE - count * GAP) / count
  const segs = []
  for (let i = 0; i < count; i++) {
    segs.push({
      index: i,
      filled: !off && i <= position,
      dasharray: `${segLen} ${CIRCUMFERENCE - segLen}`,
      dashoffset: -(i * (segLen + GAP)),
    })
  }
  return segs
}

// SVG markup for the ring, sized to overlay a 46px circular FAB (viewBox
// matches the button's own 46x46 box; see .fab-ring in app.css, and in the
// map's style.css for its rail, for the absolute-position overlay). Rotated
// -90deg so segment 0 starts at 12 o'clock instead of stroke-dasharray's
// default 3 o'clock zero-angle.
export function fabRingSvg(current, total, opts) {
  const segs = ringSegments(current, total, opts)
  if (!segs.length) return ''
  const circles = segs.map((s) =>
    `<circle cx="23" cy="23" r="${RADIUS}" fill="none" stroke-width="2" stroke-linecap="round" ` +
    `stroke="${s.filled ? 'var(--ch-accent)' : 'var(--ch-muted)'}" ` +
    `stroke-dasharray="${s.dasharray}" stroke-dashoffset="${s.dashoffset}"/>`
  ).join('')
  return `<span class="fab-ring" aria-hidden="true"><svg width="46" height="46" viewBox="0 0 46 46">${circles}</svg></span>`
}
