import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LAYER_ORDER } from '../huntmap.js'
import { NODE_GLYPH_LAYERS } from '../nodeglyphs.js'

// #626, the over/under half. addOverlays adds every layer behind a getLayer
// guard, so before this the stack was whatever order the adds happened to run
// in — and a run that landed on a half-applied style added part of it, leaving
// the next run to put the rest on top. The order is declared now and applied
// in one pass, which only works while the declaration knows every layer.
//
// huntmap.js is DOM-bound and stays out of the unit suite (AGENTS.md §5), so
// this reads it as text. That is the point: it catches a layer added in a
// future change and not declared here, which is exactly how the stack drifted
// in the first place.
const SRC = readFileSync(new URL('../huntmap.js', import.meta.url), 'utf8')
// The node glyph layers are added from their specs (nodeglyphs.js, #632), so
// their ids are not literals in huntmap.js; the module names them.
const added = [...SRC.matchAll(/addLayer\(\{\s*id: '([^']+)'/g)].map((m) => m[1]).concat(NODE_GLYPH_LAYERS)

describe('LAYER_ORDER covers what the map actually adds', () => {
  // A regex that matched nothing would make every assertion below vacuous.
  it('finds the layer adds at all', () => {
    expect(added.length).toBeGreaterThan(8)
  })

  it('declares every layer the module adds', () => {
    const missing = added.filter((id) => !LAYER_ORDER.includes(id))
    expect(missing, 'added but not declared, so it would float to the top').toEqual([])
  })

  it('declares nothing the module never adds', () => {
    const dead = LAYER_ORDER.filter((id) => !added.includes(id))
    expect(dead, 'declared but never added').toEqual([])
  })

  it('names each layer once, so the pass cannot move one twice', () => {
    expect(LAYER_ORDER.length).toBe(new Set(LAYER_ORDER).size)
  })
})

// The relations the old code expressed by hand, kept as claims rather than as
// side effects of call order. Each was written down somewhere before this:
// ensureDem inserted the hillshade with beforeId 'trail', and the reach comment
// says the rays go under the dots so a hub stays readable.
describe('the order keeps the decisions the code used to encode in its adds', () => {
  const below = (a, b) => LAYER_ORDER.indexOf(a) < LAYER_ORDER.indexOf(b)

  it('puts the terrain shading under everything we draw', () => {
    for (const id of LAYER_ORDER.slice(1)) expect(below('hillshade', id), id).toBe(true)
  })

  it('keeps the coverage rays under the dots', () => {
    expect(below('reach', 'points')).toBe(true)
  })

  it('keeps the arrival pulse and the highlight above the dots they mark', () => {
    expect(below('points', 'pulse')).toBe(true)
    expect(below('points', 'highlight')).toBe(true)
  })

  it('keeps the node-position layer above the hex heat it opts in over', () => {
    expect(below('hex', 'nodedrift')).toBe(true)
    expect(below('hex-3d', 'nodecircle-search')).toBe(true)
  })
})
