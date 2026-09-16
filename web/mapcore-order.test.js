import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LAYER_ORDER } from './mapcore.js'

// #626, the over/under half, the map's copy of app/src/__tests__/huntmap-order.
// addOverlays adds every layer behind a getLayer guard, so before this the
// stack was whatever order the adds happened to run in — and a run that landed
// on a half-applied style added part of it, leaving the next run to put the
// rest on top. The order is declared now and applied in one pass, which only
// works while the declaration knows every layer.
//
// mapcore.js is WebGL and DOM glue and stays out of the unit suite, so this
// reads it as text. That is the point: it catches a layer added in a future
// change and not declared here, which is how the stack drifted in the first
// place.
const SRC = readFileSync(new URL('./mapcore.js', import.meta.url), 'utf8')
const literal = [...SRC.matchAll(/addLayer\(\{\s*id: '([^']+)'/g)].map((m) => m[1])
// The two CoreScope layers are added in a loop over their source ids, so they
// carry `id: src` and the pattern above cannot see them.
const looped = [...SRC.matchAll(/for \(const src of \[([^\]]+)\]\)/g)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
const added = [...literal, ...looped]

describe('LAYER_ORDER covers what the map actually adds', () => {
  // A pattern that matched nothing would make every assertion below vacuous.
  it('finds the layer adds at all, both the literal ones and the looped pair', () => {
    expect(literal.length).toBeGreaterThan(8)
    expect(looped).toEqual(['observer-advert', 'observer-rxlog'])
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
// side effects of call order. Each was written down in a comment before this:
// the reach lines go under the dots, and the playhead ring is added last so it
// is never under a point.
describe('the order keeps the decisions the code used to encode in its adds', () => {
  const below = (a, b) => LAYER_ORDER.indexOf(a) < LAYER_ORDER.indexOf(b)

  it('puts the terrain shading under everything we draw', () => {
    for (const id of LAYER_ORDER.slice(1)) expect(below('hillshade', id), id).toBe(true)
  })

  it('keeps the reach lines under the dots', () => {
    expect(below('reach', 'points')).toBe(true)
  })

  it('keeps the ticker playhead ring above everything it marks', () => {
    for (const id of LAYER_ORDER.filter((x) => x !== 'rxhighlight')) {
      expect(below(id, 'rxhighlight'), id).toBe(true)
    }
  })

  it('keeps the hex outline with its fill, and both under the dots', () => {
    expect(below('hex', 'hex-outline')).toBe(true)
    expect(below('hex-outline', 'points')).toBe(true)
  })
})
