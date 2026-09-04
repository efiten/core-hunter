import { describe, it, expect } from 'vitest'
import { layerVisibility, pitchFor, pitchTransition, PITCH_3D, VIEW_STATES, VIEW_LABELS, nextViewIndex, viewKey } from '../maplayers.js'

// #250/#266: which of the four signal layers is visible for a given
// layer-mode / 2D-3D combination. Extracted from huntmap.js because that file
// is DOM-bound and excluded from unit testing (AGENTS.md §5), while this is
// exactly the decision that was wrong — and it was duplicated in two places
// (addOverlays and the 3D toggle) that had already drifted apart.
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
      expect(vis(m, false)).toMatchObject({ 'hex-3d': false, 'points-3d': false })
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

// #258: the layer-mode FAB and the 2D/3D FAB merge into one 5-state cycle.
// "2D · hex only" is deliberately dropped -- 5 states, not the full 3x2=6
// combination matrix.
describe('VIEW_STATES / nextViewIndex (#258)', () => {
  it('has exactly the 5 states in the decided order, dropping 2D hex-only', () => {
    expect(VIEW_STATES).toEqual([
      { mode: 'points', mode3D: false },
      { mode: 'both', mode3D: false },
      { mode: 'hex', mode3D: true },
      { mode: 'points', mode3D: true },
      { mode: 'both', mode3D: true },
    ])
  })
  it('never contains the dropped 2D-hex-only combination', () => {
    expect(VIEW_STATES.some((s) => s.mode === 'hex' && !s.mode3D)).toBe(false)
  })
  // The whole visited sequence, not just where it lands after 5 steps: a step
  // function that is correct for some indices and jumps for others still ends
  // at 0 after five taps, so the endpoint alone proves nothing.
  it('visits every state in order, one per tap, and wraps back to 0', () => {
    const visited = []
    let i = 0
    for (let n = 0; n < 5; n++) { i = nextViewIndex(i); visited.push(i) }
    expect(visited).toEqual([1, 2, 3, 4, 0])
  })
  it('treats an out-of-range index as if it were before the first state', () => {
    expect(nextViewIndex(-1)).toBe(1)
    expect(nextViewIndex(99)).toBe(1)
    expect(nextViewIndex(undefined)).toBe(1)
    expect(nextViewIndex(1.5)).toBe(1)
  })
})

// A state with no label reaches a screen reader as "undefined", and a state
// with no icon writes that string into the button — neither shows up in a
// build or a render test, so the maps are pinned to VIEW_STATES here.
describe('VIEW_LABELS covers VIEW_STATES (#258)', () => {
  it('has a spoken label for every state', () => {
    for (const s of VIEW_STATES) expect(VIEW_LABELS[viewKey(s)]).toBeTruthy()
  })
  it('has no label for a state that does not exist', () => {
    const keys = VIEW_STATES.map(viewKey)
    expect(Object.keys(VIEW_LABELS).sort()).toEqual([...keys].sort())
  })
  it('keeps middle dots out of the spoken labels', () => {
    for (const l of Object.values(VIEW_LABELS)) expect(l).not.toContain('·')
  })
  it('gives 2D and 3D distinct keys for the same layer mode', () => {
    expect(viewKey({ mode: 'both', mode3D: false })).not.toBe(viewKey({ mode: 'both', mode3D: true }))
  })
})

// Camera pitch per view state (#336). It lives here with layerVisibility for
// the same reason: setView() applies visibility, pitch and buildings together,
// and a pitch that disagrees with the layer set is the bug that split them in
// the first place.
describe('pitchFor — camera tilt per view state', () => {
  it('is flat in 2D', () => {
    expect(pitchFor(false)).toBe(0)
  })
  it('is tilted in 3D', () => {
    expect(pitchFor(true)).toBe(PITCH_3D)
    expect(PITCH_3D).toBe(60)
  })
  it('tilts short of horizontal, so the horizon never enters the frame', () => {
    expect(pitchFor(true)).toBeLessThan(90)
  })
  it('reads any truthy/falsy flag, since it comes from persisted state', () => {
    expect(pitchFor(undefined)).toBe(0)
    expect(pitchFor(null)).toBe(0)
    expect(pitchFor(1)).toBe(PITCH_3D)
  })
  it('gives every VIEW_STATES entry the tilt its own flag asks for', () => {
    for (const s of VIEW_STATES) {
      expect(pitchFor(s.mode3D)).toBe(s.mode3D ? PITCH_3D : 0)
    }
  })
})

// Which FAB taps may move the camera (#333). The tilt gesture and the FAB both
// write pitch, and before this they did not compose: every tap eased back to
// PITCH_3D, so an angle set by gesture survived only until the next tap — and
// the 5-state cycle spends three of its five steps moving between two 3D
// states, none of which asked for a different tilt.
describe('pitchTransition — which FAB taps move the camera', () => {
  it('eases to the fixed tilt when entering 3D', () => {
    expect(pitchTransition(false, true)).toBe(PITCH_3D)
  })
  it('eases flat when leaving 3D, so flat is always one crossing away', () => {
    expect(pitchTransition(true, false)).toBe(0)
  })
  it('leaves a gesture-set tilt alone when the tap stays inside 3D', () => {
    expect(pitchTransition(true, true)).toBeNull()
  })
  it('leaves the camera alone when the tap stays inside 2D', () => {
    expect(pitchTransition(false, false)).toBeNull()
  })
  it('reads any truthy/falsy flag, since both sides come from persisted state', () => {
    expect(pitchTransition(undefined, 1)).toBe(PITCH_3D)
    expect(pitchTransition(1, null)).toBe(0)
    expect(pitchTransition(undefined, null)).toBeNull()
  })
  it('moves the camera exactly twice per full cycle of VIEW_STATES', () => {
    const moved = VIEW_STATES.filter((s, i) => {
      const prev = VIEW_STATES[(i + VIEW_STATES.length - 1) % VIEW_STATES.length]
      return pitchTransition(prev.mode3D, s.mode3D) !== null
    })
    expect(moved.map(viewKey)).toEqual(['points2d', 'hex3d'])
  })
})

// The hex labels (#556) ride the flat hex layer only: a label on a pillar's
// top would float at ground level under the pillar, so 3D keeps its drawing.
describe('layerVisibility carries the hex labels', () => {
  it('shows them exactly when the flat hex layer is on, in 2D', () => {
    expect(vis('both', false)['hex-labels']).toBe(true)
    expect(vis('hex', false)['hex-labels']).toBe(true)
    expect(vis('points', false)['hex-labels']).toBe(false)
  })
  it('never shows them in 3D', () => {
    expect(vis('both', true)['hex-labels']).toBe(false)
    expect(vis('hex', true)['hex-labels']).toBe(false)
  })
})
