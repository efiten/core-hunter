// The map's FAB rail (#630): zoom in, zoom out, compass, 2D/3D and node
// positions in one column at the bottom right, modelled on the app's rail.
// It replaces MapLibre's NavigationControl and the 2D/3D button added beside it
// as a second control, two boxes in one corner.
//
// Pure so the rail's decisions can be tested without a browser: map.js reads
// the map and paints the buttons.

import { nextNodePosMode } from './nodeposmode.js'

// The needle points at north on screen, so it turns against the bearing: a map
// at bearing 90 has east up and north a quarter turn counter-clockwise. Rotation
// only, unlike MapLibre's visualizePitch compass: a press does not change the
// pitch (northResetEase), so a needle that tilted with it would promise an
// effect the button does not have.
export function compassNeedleTransform(bearing) {
  return `rotate(${-bearing}deg)`
}

// Disabled at the exact bound, which the map clamps its zoom to, so a button
// that would do nothing says so. Not near the bound: one scroll tick short of
// max can still zoom in.
export function zoomButtonsDisabled(zoom, { min, max }) {
  return { zoomIn: zoom >= max, zoomOut: zoom <= min }
}

// MapLibre's own easeTo default, so the compass turns at the pace every other
// eased move on the map does.
const NORTH_EASE_MS = 500

// A compass press turns the map to north and keeps its pitch (#630): flattening
// a 3D view is the 2D/3D button's job, and an ease without a pitch key leaves
// the current one alone. Reduced motion jumps instead.
export function northResetEase({ reducedMotion }) {
  return { bearing: 0, duration: reducedMotion ? 0 : NORTH_EASE_MS }
}

// What a tap on the node-positions button does. `reason` is nodePosReason
// (auth.js) for the role: below member the tap keeps the stop and hands the
// reason back for the notice, because the button stays enabled so that a guest
// can learn what switches the layer on. From member up it cycles the app's
// stops. Before the role is known it waits: cycling would give a guest a
// member-only stop, and refusing would tell a member to log in.
export function nodePosTap(mode, { roleKnown, reason }) {
  if (!roleKnown) return { mode, reason: null, wait: true }
  if (reason) return { mode, reason, wait: false }
  return { mode: nextNodePosMode(mode), reason: null, wait: false }
}
