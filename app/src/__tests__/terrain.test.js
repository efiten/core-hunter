import { describe, it, expect } from 'vitest'
import { EXAGGERATION_STEPS, DEFAULT_EXAGGERATION, DEM_MAX_ZOOM, hillshadeFor, terrainPlan } from '../terrain.js'

// #394 (decided 2026-08-21): terrain ships on the AWS terrarium DEM with the
// exaggeration at 7, deliberately high, because the relief this has to show
// is the Netherlands and northern Belgium, where 1-2x shows nothing at all.
describe('the exaggeration steps', () => {
  it('offer the decided default, with 1x as the only literally true reading', () => {
    expect(DEFAULT_EXAGGERATION).toBe(7)
    expect(EXAGGERATION_STEPS).toContain(DEFAULT_EXAGGERATION)
    expect(EXAGGERATION_STEPS[0]).toBe(1)
    expect([...EXAGGERATION_STEPS].sort((a, b) => a - b)).toEqual(EXAGGERATION_STEPS)
  })
  // The low-poly knob measured in #335: a z10 cap is 127 KB per z14 screen
  // where z15 tiles were the freeze of #247.
  it('caps the DEM at the low-poly zoom', () => {
    expect(DEM_MAX_ZOOM).toBe(10)
  })
})

// Shading tracks the geometry: MapLibre's hillshade-exaggeration is 0..1, so
// 10x is the full shade and 1x a tenth of it, never off and never past 1.
describe('hillshadeFor', () => {
  it('scales with the exaggeration inside MapLibre range', () => {
    expect(hillshadeFor(10)).toBe(1)
    expect(hillshadeFor(7)).toBeCloseTo(0.7, 5)
    expect(hillshadeFor(1)).toBeCloseTo(0.1, 5)
  })
  it('stays inside 0..1 for anything else', () => {
    expect(hillshadeFor(20)).toBe(1)
    expect(hillshadeFor(0)).toBeCloseTo(0.1, 5)
    expect(hillshadeFor(NaN)).toBeCloseTo(0.1, 5)
  })
})

// What the map draws for a terrain state. The mesh (setTerrain) is the part
// that froze weak GPUs in #247 and makes easeTo({pitch}) a no-op, so it is
// gated three ways: the FAB is on, the DEM tiles have arrived (flat until
// then, Kasper 2026-09-05), and the view is 3D, where displacement can be
// seen at all. Hillshade is cheap and reads in 2D, so it follows the FAB alone.
describe('terrainPlan', () => {
  it('draws nothing while the FAB is off', () => {
    expect(terrainPlan({ on: false, ready: true, mode3D: true, exaggeration: 7 })).toEqual({ hillshade: false, mesh: false, exaggeration: 7 })
  })
  it('shades at once, and waits for the tiles before displacing', () => {
    expect(terrainPlan({ on: true, ready: false, mode3D: true, exaggeration: 7 })).toEqual({ hillshade: true, mesh: false, exaggeration: 7 })
    expect(terrainPlan({ on: true, ready: true, mode3D: true, exaggeration: 7 })).toEqual({ hillshade: true, mesh: true, exaggeration: 7 })
  })
  it('never displaces a flat view', () => {
    expect(terrainPlan({ on: true, ready: true, mode3D: false, exaggeration: 4 })).toEqual({ hillshade: true, mesh: false, exaggeration: 4 })
  })
  it('falls back to the default exaggeration for a value off the steps', () => {
    expect(terrainPlan({ on: true, ready: true, mode3D: true, exaggeration: 3 }).exaggeration).toBe(DEFAULT_EXAGGERATION)
  })
})
