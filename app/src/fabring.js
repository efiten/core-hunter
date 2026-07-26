// Segmented progress ring for multi-state FABs (#259): N equal arcs around the
// button, filled (accent) from the first segment through the current one, the
// rest muted — so a tap's effect (advancing to the next segment) is visible at
// a glance, not just inferable from the icon changing. Two-state plain toggles
// (2D/3D, sound's future off/rxtx/full is 3-state so it DOES get a ring) don't
// need this — a single on/off doesn't benefit from a "1 of 2" indicator.

const RADIUS = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 4 // px gap between segments, in SVG user units

// Pure geometry: one entry per segment, in draw order. `filled` = segments
// from 0 through `current` (inclusive) — a genuine progress fill, not just a
// single active-segment marker.
export function ringSegments(current, total) {
  if (total < 2) return []
  const segLen = (CIRCUMFERENCE - total * GAP) / total
  const segs = []
  for (let i = 0; i < total; i++) {
    segs.push({
      index: i,
      filled: i <= current,
      dasharray: `${segLen} ${CIRCUMFERENCE - segLen}`,
      dashoffset: -(i * (segLen + GAP)),
    })
  }
  return segs
}

// SVG markup for the ring, sized to overlay a 46px circular FAB (viewBox
// matches the button's own 46x46 box; see .fab-ring in app.css for the
// absolute-position overlay). Rotated -90deg so segment 0 starts at 12
// o'clock instead of stroke-dasharray's default 3 o'clock zero-angle.
export function fabRingSvg(current, total) {
  const segs = ringSegments(current, total)
  if (!segs.length) return ''
  const circles = segs.map((s) =>
    `<circle cx="23" cy="23" r="${RADIUS}" fill="none" stroke-width="2" stroke-linecap="round" ` +
    `stroke="${s.filled ? 'var(--ch-accent)' : 'var(--ch-muted)'}" ` +
    `stroke-dasharray="${s.dasharray}" stroke-dashoffset="${s.dashoffset}"/>`
  ).join('')
  return `<span class="fab-ring" aria-hidden="true"><svg width="46" height="46" viewBox="0 0 46 46">${circles}</svg></span>`
}
