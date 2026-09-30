import { describe, it, expect } from 'vitest'
import {
  ramp, pointShare, hexShare, backlogShare, labelShare, resForZoom, resPair, resShare, resBreaks,
  zoomRamp, zoomSwitch, stepBreaks, sampledBreaks, hexBlend, STEP_EPS, LAYER_MODES,
} from '../zoomfade.js'

const MAX = 21

describe('ramp', () => {
  it('is 0 before, 1 after and a straight line between', () => {
    const band = { from: 10, to: 12 }
    expect(ramp(9, band)).toBe(0)
    expect(ramp(10, band)).toBe(0)
    expect(ramp(11, band)).toBe(0.5)
    expect(ramp(12, band)).toBe(1)
    expect(ramp(20, band)).toBe(1)
  })
  it('is a step when the band has no width', () => {
    expect(ramp(18.99, { from: 19, to: 19 })).toBe(0)
    expect(ramp(19, { from: 19, to: 19 })).toBe(1)
  })
})

describe('the shares of 29 September 2026 (#634)', () => {
  it('auto in 2D: the points come in from 13.25 to 18.25 over a hex that stays full', () => {
    const v = { mode: 'auto', mode3D: false }
    expect(pointShare(13.25, v)).toBe(0)
    expect(pointShare(15.75, v)).toBe(0.5)
    expect(pointShare(18.25, v)).toBe(1)
    for (const z of [5, 13.25, 16, 18.25, 21]) expect(hexShare(z, v), `zoom ${z}`).toBe(1)
  })
  it('auto in 3D: the pillars arrive in one step at zoom 19, and the bars drop to 95%', () => {
    const v = { mode: 'auto', mode3D: true }
    expect(pointShare(18.99, v)).toBe(0)
    expect(pointShare(19, v)).toBe(1)
    expect(hexShare(18.99, v)).toBe(1)
    expect(hexShare(19, v)).toBe(0.95)
  })
  it('hex and points draw one layer at full strength, whatever the zoom', () => {
    for (const mode3D of [false, true]) for (const z of [5, 14, 19, 21]) {
      expect(pointShare(z, { mode: 'points', mode3D })).toBe(1)
      expect(hexShare(z, { mode: 'points', mode3D })).toBe(0)
      expect(pointShare(z, { mode: 'hex', mode3D })).toBe(0)
      expect(hexShare(z, { mode: 'hex', mode3D })).toBe(1)
    }
  })
  it('reads an unknown mode as auto, so a stored value from before cannot blank the map', () => {
    expect(LAYER_MODES).toEqual(['auto', 'hex', 'points'])
    expect(pointShare(18.25, { mode: 'both', mode3D: false })).toBe(1)
    expect(hexShare(18.25, { mode: undefined, mode3D: false })).toBe(1)
  })
  it('earlier rides come in from 11.25 to 18.75 in 2D, and with the pillars in 3D', () => {
    expect(backlogShare(11.25, { mode3D: false })).toBe(0)
    expect(backlogShare(15, { mode3D: false })).toBe(0.5)
    expect(backlogShare(18.75, { mode3D: false })).toBe(1)
    expect(backlogShare(5, { mode3D: true })).toBe(1)
  })
  it('cell names come in from 15.5 to 16.5', () => {
    expect(labelShare(15.5)).toBe(0)
    expect(labelShare(16)).toBe(0.5)
    expect(labelShare(16.5)).toBe(1)
  })
  it('blends two cell sizes over 0.95 of a zoom level in 2D and 0.75 in 3D', () => {
    expect(hexBlend(false)).toBe(0.95)
    expect(hexBlend(true)).toBe(0.75)
  })
})

describe('cell sizes: one per zoom level, the server\'s rule', () => {
  it('is the Leaflet zoom, one above MapLibre\'s, rounded and clamped', () => {
    expect(resForZoom(13, MAX)).toBe(14)
    expect(resForZoom(13.49, MAX)).toBe(14)
    expect(resForZoom(13.5, MAX)).toBe(15)
    expect(resForZoom(0, MAX)).toBe(3)
    expect(resForZoom(22, MAX)).toBe(21)
    expect(resForZoom(22, 18)).toBe(18)
  })
  it('names the two sizes around the nearest change', () => {
    expect(resPair(13.2, MAX)).toEqual({ coarse: 14, fine: 15 })
    expect(resPair(13.9, MAX)).toEqual({ coarse: 14, fine: 15 })
    expect(resPair(14, MAX)).toEqual({ coarse: 15, fine: 16 })
    expect(resPair(21.5, MAX)).toEqual({ coarse: 21, fine: 21 })
  })
  it('shows a size in full at the middle of its level and half at each end', () => {
    expect(resShare(14, 13, 0.95, MAX)).toBe(1)
    expect(resShare(14, 13.5, 0.95, MAX)).toBeCloseTo(0.5, 9)
    expect(resShare(14, 12.5, 0.95, MAX)).toBeCloseTo(0.5, 9)
    expect(resShare(14, 14, 0.95, MAX)).toBe(0)
  })
  it('adds up to 1 over the pair at every zoom, for both widths', () => {
    for (const width of [0.95, 0.75]) for (let z = 2; z <= 22; z += 0.05) {
      const { coarse, fine } = resPair(z, MAX)
      const sum = coarse === fine ? resShare(coarse, z, width, MAX) : resShare(coarse, z, width, MAX) + resShare(fine, z, width, MAX)
      expect(sum, `zoom ${z.toFixed(2)} width ${width}`).toBeCloseTo(1, 9)
    }
  })
  it('shows no third size anywhere', () => {
    for (let z = 2; z <= 22; z += 0.05) {
      const { coarse, fine } = resPair(z, MAX)
      for (let res = 3; res <= MAX; res++) {
        if (res === coarse || res === fine) continue
        expect(resShare(res, z, 0.95, MAX), `res ${res} at zoom ${z.toFixed(2)}`).toBe(0)
      }
    }
  })
  it('keeps the coarsest and the finest full past their end of the range', () => {
    expect(resShare(3, 0, 0.95, MAX)).toBe(1)
    expect(resShare(MAX, 22, 0.95, MAX)).toBe(1)
    expect(resShare(18, 22, 0.95, 18)).toBe(1)
  })
  it('holds a pair fetched at an earlier zoom in full past both its ends, until the next pair arrives', () => {
    // The website fetched 14 and 15 at zoom 13; the view zoomed on before the
    // refetch. Its pair is the whole range there is, so it never falls to 0.
    for (let z = 10; z <= 17; z += 0.05) {
      const sum = resShare(14, z, 0.95, 15, 14) + resShare(15, z, 0.95, 15, 14)
      expect(sum, `zoom ${z.toFixed(2)}`).toBeCloseTo(1, 9)
    }
    expect(resShare(14, 11, 0.95, 15, 14)).toBe(1)
    expect(resShare(15, 14.9, 0.95, 15, 14)).toBe(1)
    expect(resBreaks(14, 0.5, 15, 14)).toEqual([13.25, 13.75])
    expect(resBreaks(15, 0.5, 15, 14)).toEqual([13.25, 13.75])
  })
  it('is a hard step with no width, which is what it was', () => {
    expect(resShare(14, 13.49, 0, MAX)).toBe(1)
    expect(resShare(14, 13.5, 0, MAX)).toBe(0)
    expect(resShare(15, 13.5, 0, MAX)).toBe(1)
  })
  it('breaks where the share bends', () => {
    expect(resBreaks(14, 0.5, MAX)).toEqual([12.25, 12.75, 13.25, 13.75])
    expect(resBreaks(3, 0.5, MAX)).toEqual([2.25, 2.75])
    expect(resBreaks(MAX, 0.5, MAX)).toEqual([19.25, 19.75])
  })
})

describe('style expressions', () => {
  const evalRamp = (expr, z) => {
    if (!Array.isArray(expr)) return expr
    const stops = expr.slice(3)
    if (z <= stops[0]) return stops[1]
    for (let i = 2; i < stops.length; i += 2) {
      if (z <= stops[i]) {
        const t = (z - stops[i - 2]) / (stops[i] - stops[i - 2])
        return stops[i - 1] + t * (stops[i + 1] - stops[i - 1])
      }
    }
    return stops[stops.length - 1]
  }
  const evalStep = (expr, z) => {
    let v = expr[2]
    for (let i = 3; i < expr.length; i += 2) if (z >= expr[i]) v = expr[i + 1]
    return v
  }
  it('builds an interpolate on zoom with stops that rise', () => {
    const expr = zoomRamp([13.25, 18.25, 13.25], (z) => ramp(z, { from: 13.25, to: 18.25 }))
    expect(expr).toEqual(['interpolate', ['linear'], ['zoom'], 13.25, 0, 18.25, 1])
  })
  it('carries the per-feature value in the output, not around the ramp', () => {
    const expr = zoomRamp([10, 12], (z) => ramp(z, { from: 10, to: 12 }), (v) => ['*', ['get', 'op'], v])
    expect(expr[0]).toBe('interpolate')
    expect(expr[4]).toEqual(['*', ['get', 'op'], 0])
    expect(expr[6]).toEqual(['*', ['get', 'op'], 1])
  })
  it('follows a size\'s share through its whole level', () => {
    const expr = zoomRamp(resBreaks(14, 0.95, MAX), (z) => resShare(14, z, 0.95, MAX))
    for (let z = 11; z <= 15; z += 0.01) expect(evalRamp(expr, z), `zoom ${z.toFixed(2)}`).toBeCloseTo(resShare(14, z, 0.95, MAX), 2)
  })
  it('holds a step inside a ramp, within a thousandth of a zoom level', () => {
    const share = (z) => resShare(20, z, 0.75, MAX) * hexShare(z, { mode: 'auto', mode3D: true })
    const expr = zoomRamp([...resBreaks(20, 0.75, MAX), ...stepBreaks(19)], share)
    expect(evalRamp(expr, 19 - STEP_EPS)).toBeCloseTo(1, 2)
    expect(evalRamp(expr, 19)).toBeCloseTo(0.95, 2)
    expect(evalRamp(expr, 19.2)).toBeCloseTo(share(19.2), 2)
  })
  it('is a constant when there is nothing to bend', () => {
    expect(zoomRamp([], () => 1)).toBe(1)
    expect(zoomRamp([], () => 1, (v) => ['*', ['get', 'op'], v])).toEqual(['*', ['get', 'op'], 1])
  })
  it('switches a layer off exactly where its share is nothing', () => {
    const share = (z) => resShare(14, z, 0.95, MAX)
    const expr = zoomSwitch(resBreaks(14, 0.95, MAX), share)
    expect(expr[0]).toBe('step')
    for (let z = 11; z <= 15; z += 0.01) {
      // Not on the breaks themselves, where the share is exactly 0 on one side.
      if (resBreaks(14, 0.95, MAX).some((b) => Math.abs(b - z) < 0.011)) continue
      expect(evalStep(expr, z), `zoom ${z.toFixed(2)}`).toBe(share(z) > 0 ? 1 : 0)
    }
  })
  it('switches the pillars on at zoom 19 in 3D', () => {
    const expr = zoomSwitch(stepBreaks(19), (z) => pointShare(z, { mode: 'auto', mode3D: true }))
    expect(evalStep(expr, 18.9)).toBe(0)
    expect(evalStep(expr, 19)).toBe(1)
    expect(evalStep(expr, 21)).toBe(1)
  })
  it('samples a curve at every quarter, ends included', () => {
    expect(sampledBreaks(11.25, 12.1)).toEqual([11.25, 11.5, 11.75, 12, 12.1])
  })
})

import { hexSlots, hexFillOpacity, hexBarHeight, hexBarSwitch, pointFillOpacity, pointStrokeOpacity, pillarSwitch } from '../zoomfade.js'

describe('the two hex layers', () => {
  it('gives the even sizes slot a and the odd ones slot b', () => {
    expect(hexSlots(13.2, MAX)).toEqual({ a: 14, b: 15 })
    expect(hexSlots(14.2, MAX)).toEqual({ a: 16, b: 15 })
  })
  it('leaves the size that stays in its slot when the pair moves up', () => {
    for (let n = 3; n < 19; n++) {
      const before = hexSlots(n - 0.01, MAX), after = hexSlots(n, MAX)
      const stays = n + 1
      const slot = stays % 2 === 0 ? 'a' : 'b'
      expect(before[slot], `zoom ${n}`).toBe(stays)
      expect(after[slot], `zoom ${n}`).toBe(stays)
    }
  })
  it('swaps the other slot only while both its sizes show nothing', () => {
    for (const width of [0.95, 0.75]) for (let n = 3; n < 19; n++) {
      expect(resShare(n, n, width, MAX), `leaving at zoom ${n}`).toBe(0)
      expect(resShare(n + 2, n, width, MAX), `arriving at zoom ${n}`).toBe(0)
      expect(resShare(n + 1, n, width, MAX), `staying at zoom ${n}`).toBe(1)
    }
  })
  it('uses one slot at the end of the range', () => {
    expect(hexSlots(21.5, MAX)).toEqual({ a: null, b: 21 })
  })
})

describe('paint', () => {
  const stopsOf = (expr) => expr.slice(3).filter((_, i) => i % 2 === 0)
  const rises = (zs) => zs.every((z, i) => i === 0 || z > zs[i - 1])
  const flat = { mode: 'auto', mode3D: false }, tilted = { mode: 'auto', mode3D: true }

  it('only ever builds stops that rise, which MapLibre refuses otherwise', () => {
    for (const view of [flat, tilted, { mode: 'hex', mode3D: true }, { mode: 'points', mode3D: false }]) {
      for (let res = 3; res <= MAX; res++) {
        for (const expr of [hexFillOpacity(res, view, MAX), hexBarHeight(res, view, MAX), hexBarSwitch(res, view, MAX)]) {
          expect(rises(stopsOf(expr)), `${JSON.stringify(view)} res ${res}`).toBe(true)
        }
      }
      for (const expr of [pointFillOpacity(view), pointStrokeOpacity(view)]) {
        if (Array.isArray(expr) && expr[0] === 'interpolate') expect(rises(stopsOf(expr)), JSON.stringify(view)).toBe(true)
      }
    }
  })
  it('keeps zoom at the top of every expression', () => {
    const inner = (e) => JSON.stringify(e.slice(3)).includes('"zoom"')
    for (const expr of [hexFillOpacity(14, flat, MAX), hexBarHeight(20, tilted, MAX), hexBarSwitch(20, tilted, MAX), pointFillOpacity(flat), pointStrokeOpacity(flat), pillarSwitch(tilted)]) {
      expect(['interpolate', 'step']).toContain(expr[0])
      expect(inner(expr)).toBe(false)
    }
  })
  it('multiplies a cell\'s own opacity and a bar\'s own height by the share', () => {
    expect(hexFillOpacity(14, flat, MAX)[4]).toEqual(['*', ['get', 'op'], 0])
    expect(hexBarHeight(14, tilted, MAX)[4]).toEqual(['*', ['get', 'height'], 0])
  })
  it('drops the bars to 95% at zoom 19 in auto, and not in hex mode', () => {
    const last = (e) => e[e.length - 1]
    expect(last(hexBarHeight(MAX, tilted, MAX))).toEqual(['*', ['get', 'height'], 0.95])
    expect(last(hexBarHeight(MAX, { mode: 'hex', mode3D: true }, MAX))).toEqual(['*', ['get', 'height'], 1])
  })
  it('gives an earlier ride no fill and the product of both shares on its stroke', () => {
    const fill = pointFillOpacity(flat)
    expect(fill[fill.length - 1]).toEqual(['case', ['==', ['get', 'backlog'], 1], 0, ['*', ['get', 'fop'], 1]])
    const stroke = pointStrokeOpacity(flat)
    const at = (z) => stroke[3 + 2 * stopsOf(stroke).indexOf(z) + 1]
    // Zoom 15.75: the points are halfway (0.5), earlier rides at 0.6.
    expect(at(15.75)).toEqual(['case', ['==', ['get', 'backlog'], 1], ['*', ['get', 'op'], 0.3], ['*', ['get', 'op'], 0.5]])
    expect(at(18.75)).toEqual(['case', ['==', ['get', 'backlog'], 1], ['*', ['get', 'op'], 1], ['*', ['get', 'op'], 1]])
  })
  it('draws the points at full strength in points mode, earlier rides on their own ramp', () => {
    const view = { mode: 'points', mode3D: false }
    expect(pointFillOpacity(view)).toEqual(['case', ['==', ['get', 'backlog'], 1], 0, ['*', ['get', 'fop'], 1]])
    const stroke = pointStrokeOpacity(view)
    expect(stroke[4]).toEqual(['case', ['==', ['get', 'backlog'], 1], ['*', ['get', 'op'], 0], ['*', ['get', 'op'], 1]])
  })
  it('keeps the pillars on at every zoom in points mode', () => {
    expect(pillarSwitch({ mode: 'points', mode3D: true })).toBe(1)
  })
})
