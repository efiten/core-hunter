// Which signal layers are visible for a given layer-mode / 2D-3D combination.
//
// Pulled out of huntmap.js (#266) for two reasons. It was duplicated there —
// once when the layers are added on style load, once in the 3D toggle — and the two
// copies had already drifted, so a theme switch could leave a different set
// visible than a FAB tap. And huntmap.js is DOM-bound, so AGENTS.md §5 keeps
// it out of the unit suite; this is the part worth pinning.
//
// The 3D rule that is not obvious: when pillars are drawn, the hex layer is
// drawn FLAT rather than extruded. buildHexFC gives a cell the maximum RSSI
// inside it, so an extruded bar is by construction at least as tall as every
// pillar standing in that cell — and both are fill-extrusion sharing one depth
// pass with depth write, so the pillar's fragments fail the depth test and are
// discarded. (fill-extrusion-opacity does not disable depth writes.) Flattening
// the hex removes the occluder while keeping the coverage context under the
// pillars. Extruded bars are still what 'hex' mode shows in 3D — there are no
// pillars to hide there, and the bars are the whole point of that view.

const MODES = ['both', 'hex', 'points']

// The 5-state combined layer+3D cycle (#258): merges the old layer-toggle FAB
// (both/hex/points) and the 2D/3D FAB into one, freeing a FAB slot. "2D · hex
// only" is deliberately dropped -- 5 states, not the full 3x2=6 combination
// matrix (decided 2026-07-16).
export const VIEW_STATES = [
  { mode: 'points', mode3D: false },
  { mode: 'both', mode3D: false },
  { mode: 'hex', mode3D: true },
  { mode: 'points', mode3D: true },
  { mode: 'both', mode3D: true },
]

// Stable key per VIEW_STATES entry — the icon/label lookup in app.js and the
// persisted storage value both use it, so storage survives a reorder.
export const viewKey = (s) => s.mode + (s.mode3D ? '3d' : '2d')

// Spoken form of each state, read out as the FAB's aria-label. Lives here
// rather than in app.js so the suite can pin that every state has one — a
// missing entry would otherwise reach a screen reader as "undefined".
// Comma, not "·": a middle dot is either spoken as "middle dot" or dropped.
export const VIEW_LABELS = {
  points2d: '2D, points', both2d: '2D, hex + points', hex3d: '3D, hex',
  points3d: '3D, points', both3d: '3D, hex + points',
}

// Cycles forward through VIEW_STATES. An out-of-range index (corrupt/legacy
// storage) is treated the same way nextSoundMode treats an unknown mode: as
// if it were "before the first state", so the next tap lands on index 1.
export function nextViewIndex(i) {
  const valid = Number.isInteger(i) && i >= 0 && i < VIEW_STATES.length
  return (Math.max(valid ? i : -1, 0) + 1) % VIEW_STATES.length
}

// Camera pitch for the 3D view. 60° reads as a tilted plan rather than a
// first-person view — far enough to give the extruded bars height, short
// enough to keep the horizon out of frame.
export const PITCH_3D = 60
export function pitchFor(mode3D) { return mode3D ? PITCH_3D : 0 }

export function layerVisibility({ mode, mode3D } = {}) {
  // Unknown/absent mode follows the app's cold default rather than hiding
  // everything, so a corrupt persisted value can't produce a blank map.
  const m = MODES.includes(mode) ? mode : 'hex'
  const showHex = m !== 'points'
  const showPoints = m !== 'hex'

  if (!mode3D) {
    return { hex: showHex, 'hex-3d': false, points: showPoints, 'points-3d': false }
  }
  return {
    // Flat when pillars share the scene, extruded when they don't.
    hex: showHex && showPoints,
    'hex-3d': showHex && !showPoints,
    points: false,
    'points-3d': showPoints,
  }
}
