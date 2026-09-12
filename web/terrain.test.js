import { describe, it, expect, vi, afterEach } from 'vitest'
import { EXAGGERATION_STEPS, DEFAULT_EXAGGERATION, DEM_MAX_ZOOM, hillshadeFor, terrainPlan, isDemTileError, reportMapError } from './terrain.js'

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

// What the map draws for a terrain state. The 3D view is the switch (Kasper,
// 2026-09-06): a flat view has nothing to raise, so nothing is drawn. The
// mesh (setTerrain) is the part that froze weak GPUs in #247 and makes
// easeTo({pitch}) a no-op, so in 3D it also waits for the DEM tiles (flat
// until then, Kasper 2026-09-05). Hillshade is cheap and comes with the view.
describe('terrainPlan', () => {
  it('draws nothing in a flat view, tiles or not', () => {
    expect(terrainPlan({ mode3D: false, ready: true, exaggeration: 4 })).toEqual({ hillshade: false, mesh: false, exaggeration: 4 })
  })
  it('shades as 3D starts, and waits for the tiles before displacing', () => {
    expect(terrainPlan({ mode3D: true, ready: false, exaggeration: 7 })).toEqual({ hillshade: true, mesh: false, exaggeration: 7 })
    expect(terrainPlan({ mode3D: true, ready: true, exaggeration: 7 })).toEqual({ hillshade: true, mesh: true, exaggeration: 7 })
  })
  it('falls back to the default exaggeration for a value off the steps', () => {
    expect(terrainPlan({ mode3D: true, ready: true, exaggeration: 3 }).exaggeration).toBe(DEFAULT_EXAGGERATION)
  })
})

// The map's 'error' listener. A failed DEM tile never arrives and the map
// stays flat, so it stays out of the console. Registering any listener takes
// MapLibre's own console.error away (Evented.fire logs only when nothing
// listens), so every other error is logged here instead. The events are
// shaped as MapLibre 4.7 fires them: a failed tile carries `tile`, the
// source's own load failure does not, and the style adds `sourceId` on the
// way up to the map.
describe('map errors', () => {
  const error = new Error('boom')
  const demTile = { type: 'error', error, tile: {}, sourceId: 'dem' }
  const basemapTile = { type: 'error', error, tile: {}, sourceId: 'openmaptiles' }
  const demSource = { type: 'error', error, sourceId: 'dem' }
  const styleLoad = { type: 'error', error }
  afterEach(() => { vi.restoreAllMocks() })

  it('tells a failed DEM tile from every other error', () => {
    expect(isDemTileError(demTile)).toBe(true)
    expect(isDemTileError(basemapTile)).toBe(false)
    expect(isDemTileError(demSource)).toBe(false)
    expect(isDemTileError(styleLoad)).toBe(false)
  })
  it('keeps a failed DEM tile out of the console', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportMapError(demTile)
    expect(log).not.toHaveBeenCalled()
  })
  it('logs every other error the way MapLibre does without a listener', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportMapError(styleLoad)
    reportMapError(basemapTile)
    reportMapError(demSource)
    expect(log.mock.calls).toEqual([[error], [error], [error]])
  })
})
