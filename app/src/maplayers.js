// Which signal layers are visible for a given layer-mode / 2D-3D combination.
//
// Pulled out of huntmap.js (#266) for two reasons. It was duplicated there —
// once when the layers are added on style load, once in the 3D toggle — and the two
// copies had already drifted, so a theme switch could leave a different set
// visible than a FAB tap. And huntmap.js is DOM-bound, so AGENTS.md §5 keeps
// it out of the unit suite; this is the part worth pinning.
//
// What a layer shows at a zoom is not decided here: that is a share, handed
// to the style as a zoom expression (zoomfade.js, #634). This says which
// layers exist for a view at all.
//
// 'auto' took the place of 'both' in #634: hex and points together, each at
// the share its zoom gives it.
//
// The 3D rule that is not obvious: buildHexFC gives a cell the maximum RSSI
// inside it, so an extruded bar is by construction at least as tall as every
// pillar standing in that cell, and both are fill-extrusion sharing one depth
// pass with depth write, so the pillar's fragments fail the depth test and are
// discarded. (fill-extrusion-opacity does not disable depth writes.) Until
// #634 the hex was therefore drawn FLAT whenever pillars shared the scene.
// Now the pillars only arrive at zoom 19 (POINT_STEP_3D), and from there the
// bars stand at 95% of their height (HEX_UNDER_PILLARS_3D), so the strongest
// pillar of a cell clears its bar. Up to that zoom the bars are the whole
// view, which is what flat cells under no pillars could not give.

const MODES = ['auto', 'hex', 'points']

// The 5-state combined layer+3D cycle (#258): merges the old layer-toggle FAB
// (both/hex/points) and the 2D/3D FAB into one, freeing a FAB slot. "2D · hex
// only" is deliberately dropped -- 5 states, not the full 3x2=6 combination
// matrix (decided 2026-07-16).
export const VIEW_STATES = [
  { mode: 'points', mode3D: false },
  { mode: 'auto', mode3D: false },
  { mode: 'hex', mode3D: true },
  { mode: 'points', mode3D: true },
  { mode: 'auto', mode3D: true },
]

// Stable key per VIEW_STATES entry — the icon/label lookup in app.js and the
// persisted storage value both use it, so storage survives a reorder.
export const viewKey = (s) => s.mode + (s.mode3D ? '3d' : '2d')

// Spoken form of each state, read out as the FAB's aria-label. Lives here
// rather than in app.js so the suite can pin that every state has one — a
// missing entry would otherwise reach a screen reader as "undefined".
// Comma, not "·": a middle dot is either spoken as "middle dot" or dropped.
export const VIEW_LABELS = {
  points2d: '2D, points', auto2d: '2D, hex, points when zoomed in', hex3d: '3D, hex',
  points3d: '3D, points', auto3d: '3D, hex, points when zoomed in',
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

// Which FAB taps are allowed to move the camera (#333). The FAB and the tilt
// gesture (huntmap.js, maxPitch 85) both write pitch, and they only compose if
// the FAB stops overwriting an angle the user chose: a tap that stays on one
// side of the 2D/3D line leaves the camera alone and returns null. Crossing
// the line still eases to the fixed pitch, so the FAB stays the introduction
// to 3D, and flat is never more than one crossing away. Three of the five
// steps in the VIEW_STATES cycle are same-side, and none of them is a request
// for a different tilt -- they change which layers are drawn.
export function pitchTransition(was3D, is3D) {
  return !!was3D === !!is3D ? null : pitchFor(is3D)
}

export function layerVisibility({ mode, mode3D } = {}) {
  // Unknown/absent mode follows the app's cold default rather than hiding
  // everything, so a corrupt persisted value can't produce a blank map.
  // 'both' is what a view stored before #634 still says: it reads as auto.
  const m = mode === 'both' ? 'auto' : MODES.includes(mode) ? mode : 'hex'
  const showHex = m !== 'points'
  const showPoints = m !== 'hex'

  if (!mode3D) {
    // The hex labels (#556) ride the flat hex layer, in 2D only; the pulse
    // rings where the flat points are drawn, and its 3D form stays off here.
    return { hex: showHex, 'hex-b': showHex, 'hex-3d': false, 'hex-3d-b': false, points: showPoints, 'points-3d': false, 'hex-labels': showHex, pulse: showPoints, 'pulse-3d': false }
  }
  return {
    // Extruded whenever the hex is on (#634); see the 3D rule above.
    hex: false,
    'hex-b': false,
    'hex-3d': showHex,
    // The second cell size, while one takes over from the other (zoomfade.js).
    'hex-3d-b': showHex,
    points: false,
    'points-3d': showPoints,
    // A label on a pillar's top would float at ground level under it, and the
    // pulse's flat ring would sit on the ground under the reception's pillar.
    'hex-labels': false,
    pulse: false,
    // So the pulse takes a second form here instead of being dropped (#648):
    // the reception's own pillar flashes. Before that the age fade was what
    // said "recent" in 3D, and removing it left the view with nothing that
    // marks an arrival. One form per dimension, never both at once.
    'pulse-3d': showPoints,
  }
}
