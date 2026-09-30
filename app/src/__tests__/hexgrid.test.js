import { describe, it, expect } from 'vitest'
import { hexSizeForRes, hexResForZoom, HEX_TARGET_PX, HEX_MAX_RES } from '../hexgrid.js'

describe('hexSizeForRes (#634: the server\'s sizes)', () => {
  it('halves with every resolution', () => {
    for (let res = 3; res < 21; res++) expect(hexSizeForRes(res) / hexSizeForRes(res + 1)).toBeCloseTo(2, 12)
  })
  it('matches server/internal/geo/hexgrid.go: 14 px of Mercator units at that Leaflet zoom', () => {
    expect(hexSizeForRes(0)).toBeCloseTo(14 * 156543.03392, 6)
    expect(hexSizeForRes(14)).toBeCloseTo(133.765, 3)
    expect(hexSizeForRes(18)).toBeCloseTo(8.3603, 4)
  })
  it('draws a cell 28 px tall at the zoom it belongs to', () => {
    // Point to point is twice the circumradius. MapLibre zoom z shows
    // 156543.03392 / 2^(z + 1) Mercator units per pixel.
    for (const z of [5, 11, 14, 19]) {
      const res = hexResForZoom(z)
      const unitsPerPx = 156543.03392 / Math.pow(2, z + 1)
      expect(2 * hexSizeForRes(res) / unitsPerPx, `zoom ${z}`).toBeCloseTo(HEX_TARGET_PX, 9)
    }
  })
})

describe('hexResForZoom (#634: one size per zoom level)', () => {
  it('is the Leaflet zoom, one above MapLibre\'s, rounded', () => {
    expect(hexResForZoom(13)).toBe(14)
    expect(hexResForZoom(13.49)).toBe(14)
    expect(hexResForZoom(13.5)).toBe(15)
    expect(hexResForZoom(14)).toBe(15)
  })
  it('stops at 3 and at the app\'s finest, 21', () => {
    expect(hexResForZoom(0)).toBe(3)
    expect(hexResForZoom(20)).toBe(21)
    expect(hexResForZoom(22)).toBe(HEX_MAX_RES)
  })
  it('ends finer than the 3 units the old bands ended on', () => {
    expect(hexSizeForRes(HEX_MAX_RES)).toBeLessThan(3)
  })
})
