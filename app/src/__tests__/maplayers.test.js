import { describe, it, expect } from 'vitest'
import { layerVisibility } from '../maplayers.js'

// #250/#266: which of the four signal layers is visible for a given
// layer-mode / 2D-3D combination. Extracted from huntmap.js because that file
// is DOM-bound and excluded from unit testing (AGENTS.md §5), while this is
// exactly the decision that was wrong — and it was duplicated in two places
// (addOverlays and set3D) that had already drifted apart.
const vis = (mode, mode3D) => layerVisibility({ mode, mode3D })

describe('layerVisibility in 2D', () => {
  it('both shows the flat hex and the flat points', () => {
    expect(vis('both', false)).toMatchObject({ hex: true, points: true, 'hex-3d': false, 'points-3d': false })
  })
  it('hex shows only the flat hex', () => {
    expect(vis('hex', false)).toMatchObject({ hex: true, points: false })
  })
  it('points shows only the flat points', () => {
    expect(vis('points', false)).toMatchObject({ hex: false, points: true })
  })
  it('never shows a 3D layer in 2D', () => {
    for (const m of ['both', 'hex', 'points']) {
      expect(vis(m, true === false)).toMatchObject({ 'hex-3d': false, 'points-3d': false })
    }
  })
})

describe('layerVisibility in 3D', () => {
  // The bug (#266): buildHexFC gives a cell the MAX rssi in it, so the
  // extruded bar is by construction at least as tall as every pillar inside
  // it, and both layers are fill-extrusion sharing one depth pass with depth
  // write. The pillar's fragments lose the depth test and vanish. Drawing the
  // hex FLAT on the ground removes the occluder entirely while keeping the
  // coverage context under the pillars.
  it('draws hex FLAT under the pillars when both layers are shown', () => {
    expect(vis('both', true)).toMatchObject({
      hex: true, 'hex-3d': false, 'points-3d': true, points: false,
    })
  })

  it('never shows extruded hex and pillars at the same time', () => {
    for (const m of ['both', 'hex', 'points']) {
      const v = vis(m, true)
      expect(v['hex-3d'] && v['points-3d']).toBe(false)
    }
  })

  it('keeps the extruded bars when hex is the only layer — that is what 3D hex is for', () => {
    expect(vis('hex', true)).toMatchObject({
      'hex-3d': true, hex: false, 'points-3d': false, points: false,
    })
  })

  it('shows pillars with no hex at all in points mode', () => {
    expect(vis('points', true)).toMatchObject({
      'points-3d': true, hex: false, 'hex-3d': false, points: false,
    })
  })

  it('never shows a flat point layer in 3D', () => {
    for (const m of ['both', 'hex', 'points']) expect(vis(m, true).points).toBe(false)
  })
})

describe('layerVisibility is total', () => {
  it('always answers for all four layers, so a caller cannot read undefined', () => {
    for (const m of ['both', 'hex', 'points']) {
      for (const d of [true, false]) {
        const v = vis(m, d)
        for (const k of ['hex', 'hex-3d', 'points', 'points-3d']) expect(typeof v[k]).toBe('boolean')
      }
    }
  })
  it('treats an unknown mode as the cold default (hex), not as nothing visible', () => {
    expect(vis('', false)).toMatchObject({ hex: true, points: false })
  })
})
