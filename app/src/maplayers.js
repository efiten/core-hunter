// Which signal layers are visible for a given layer-mode / 2D-3D combination.
//
// Pulled out of huntmap.js (#266) for two reasons. It was duplicated there —
// once when the layers are added on style load, once in set3D — and the two
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
