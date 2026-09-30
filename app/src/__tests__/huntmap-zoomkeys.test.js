import { describe, it, expect } from 'vitest'
import { zoomKeys } from '../huntmap.js'
import { HEX_MAX_RES } from '../hexgrid.js'

// What a zoom step asks of the draw while the fingers move (#634). The data
// key names what has to be built at all; the cells key what has to be rebuilt
// at another size. Only the first needs the full draw.
const view = { mode: 'auto', mode3D: false }
const keys = (z) => zoomKeys(z, view, HEX_MAX_RES)

describe('zoomKeys', () => {
  it('moves the cells key at the half zoom where the labels and the noise change size', () => {
    // 13.4 and 13.6 share a pair of hex layers, but the size drawn in full is
    // 14 below 13.5 and 15 above it.
    expect(keys(13.4).cells).not.toBe(keys(13.6).cells)
  })
  it('moves the cells key at the whole zoom where the pair of hex layers moves', () => {
    expect(keys(13.9).cells).not.toBe(keys(14.1).cells)
  })
  it('keeps the data key while no layer\'s share leaves nothing', () => {
    expect(keys(13.6).data).toBe(keys(14.1).data)
  })
  it('moves the data key where the points arrive', () => {
    expect(keys(13.2).data).not.toBe(keys(13.3).data)
  })
})
