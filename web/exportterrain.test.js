import { describe, it, expect } from 'vitest'
import { terrariumElevation, tilePixel, tilesFor, elevationFrom, MAX_TILES } from './exportterrain.js'
import { DEM_MAX_ZOOM } from './terrain.js'

// #720: the ground under the reach export, read from the Terrarium tiles
// the 3D view draws.

describe('reading the Terrarium tiles (#720)', () => {
  it('decodes a pixel to metres', () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0)
    expect(terrariumElevation(128, 100, 128)).toBe(100.5)
    expect(terrariumElevation(127, 255, 0)).toBe(-1)
  })

  it('finds the tile and the pixel a place falls in', () => {
    // 0,0 is where the four zoom-1 tiles meet; the far corners of the world
    // fall in the first and the last tile.
    expect(tilePixel(0, 0, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 })
    expect(tilePixel(85.05, -179.999, 3)).toMatchObject({ x: 0, y: 0, px: 0, py: 0 })
    expect(tilePixel(-85.05, 179.999, 3)).toMatchObject({ x: 7, y: 7, px: 255, py: 255 })
  })

  it('fetches the tiles under a repeater and its hearings, at the 3D view\'s zoom', () => {
    const one = tilesFor([{ lat: 51.84, lon: 5.86 }])
    expect(one.every((t) => t.z === DEM_MAX_ZOOM)).toBe(true)
    expect(one).toContainEqual({ z: 10, ...xy(tilePixel(51.84, 5.86, 10)) })
    // A hearing 30 km east takes the tiles in between along.
    const wide = tilesFor([{ lat: 51.84, lon: 5.86 }, { lat: 51.84, lon: 6.3 }])
    const xs = [...new Set(wide.map((t) => t.x))].sort((a, b) => a - b)
    expect(xs).toEqual(range(tilePixel(51.84, 5.85, 10).x, tilePixel(51.84, 6.31, 10).x))
    expect(MAX_TILES).toBe(64)
  })

  it('takes the tile next door along when a place lies at a tile\'s edge', () => {
    // Zoom-10 tile 528 starts at 5.625° east; a place 350 m inside it has
    // cells reaching over the edge.
    expect(tilePixel(51.84, 5.63, 10).x).toBe(528)
    expect(tilesFor([{ lat: 51.84, lon: 5.63 }]).map((t) => t.x)).toContain(527)
  })

  it('reads the ground at a place from its tile, and nothing off the tiles', () => {
    const t = tilePixel(51.84, 5.86, 10)
    const px = new Uint8ClampedArray(256 * 256 * 4)
    const i = (t.py * 256 + t.px) * 4
    px.set([128, 42, 128, 255], i)
    const at = elevationFrom(new Map([[`${t.x}/${t.y}`, px]]))
    expect(at(51.84, 5.86)).toBe(42.5)
    expect(at(52.5, 7.5)).toBeNull()
  })
})

const xy = ({ x, y }) => ({ x, y })
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
