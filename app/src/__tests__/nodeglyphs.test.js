import { describe, it, expect } from 'vitest'
import { advertFeature, dotFeature, nodeGlyphLayers, nearestGlyph, hitBox, drawTriangle, DIM_OPACITY, HIT_HALF_PX, TRI_W, TRI_H, TRI_IMAGE, NODE_ADVERT_LAYER, NODE_DOT_LAYER, NODE_GLYPH_SOURCE, NODE_DOT_SOURCE } from '../nodeglyphs.js'

// #632: the node layer's ▲ and ● as GL features rather than DOM markers.

describe('advertFeature', () => {
  it('carries what the symbol layer paints: label, colour, selection, opacity', () => {
    const f = advertFeature({ key: 'AB'.repeat(32), lon: 5.8, lat: 51.8, label: 'NL-NIJ-RPT', color: '#4f8cff', selected: true })
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [5.8, 51.8] })
    expect(f.properties).toEqual({ kind: 'advert', key: 'ab'.repeat(32), label: 'NL-NIJ-RPT', color: '#4f8cff', sel: true, op: 1 })
  })
  it('prints nothing for a name the declutter dropped', () => {
    expect(advertFeature({ key: 'a', lon: 0, lat: 0, label: null, color: '#fff' }).properties.label).toBe('')
  })
  it('dims to the opacity the markers wore', () => {
    expect(advertFeature({ key: 'a', lon: 0, lat: 0, color: '#fff', dim: true }).properties.op).toBe(DIM_OPACITY)
  })
})

describe('dotFeature', () => {
  it('is an estimate or a hub, keyed by what a tap selects', () => {
    expect(dotFeature({ key: 'K', kind: 'estimate', lon: 1, lat: 2, color: '#f00' }).properties).toEqual({ kind: 'estimate', key: 'k', color: '#f00', op: 1 })
    expect(dotFeature({ key: '64', kind: 'hub', lon: 1, lat: 2, color: '#0f0', dim: true }).properties.op).toBe(DIM_OPACITY)
  })
})

describe('nodeGlyphLayers', () => {
  const layers = nodeGlyphLayers({ text: '#e6edf3', bg: '#0b0e14', surface: '#121721' })
  it('is the dot layer under the advert layer, each on its own source', () => {
    expect(layers.map((l) => [l.id, l.type, l.source])).toEqual([
      [NODE_DOT_LAYER, 'circle', NODE_DOT_SOURCE],
      [NODE_ADVERT_LAYER, 'symbol', NODE_GLYPH_SOURCE],
    ])
  })
  it('leaves every glyph and name in place: the declutter decides, not MapLibre', () => {
    const { layout } = layers[1]
    expect(layout['icon-allow-overlap']).toBe(true)
    expect(layout['icon-ignore-placement']).toBe(true)
    expect(layout['text-allow-overlap']).toBe(true)
    expect(layout['text-ignore-placement']).toBe(true)
    expect(layout['icon-image']).toBe(TRI_IMAGE)
  })
  it('paints colour and opacity per feature, and the selected name heavier in a surface halo', () => {
    const { paint, layout } = layers[1]
    expect(paint['icon-color']).toEqual(['get', 'color'])
    expect(paint['text-opacity']).toEqual(['get', 'op'])
    expect(layout['text-size']).toEqual(['case', ['get', 'sel'], 12, 11])
    expect(paint['text-halo-color']).toEqual(['case', ['get', 'sel'], '#121721', '#0b0e14'])
    expect(layers[0].paint['circle-stroke-color']).toBe('#0b0e14')
    expect(layers[0].paint['circle-opacity']).toEqual(['get', 'op'])
  })
})

describe('nearestGlyph and hitBox', () => {
  const project = ([lon, lat]) => ({ x: lon * 10, y: lat * 10 })
  const at = (lon, lat, kind) => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { kind } })
  it('asks about a 30px box around the tap', () => {
    expect(hitBox({ x: 100, y: 50 })).toEqual([[100 - HIT_HALF_PX, 50 - HIT_HALF_PX], [100 + HIT_HALF_PX, 50 + HIT_HALF_PX]])
  })
  it('picks the glyph nearest the tap, whatever order the query returned them in', () => {
    const far = at(1, 1, 'advert'), near = at(1.2, 1.1, 'estimate')
    expect(nearestGlyph([far, near], { x: 12, y: 11 }, project)).toBe(near)
    expect(nearestGlyph([near, far], { x: 10, y: 10 }, project)).toBe(far)
  })
  it('is null for an empty box', () => {
    expect(nearestGlyph([], { x: 0, y: 0 }, project)).toBeNull()
    expect(nearestGlyph(null, { x: 0, y: 0 }, project)).toBeNull()
  })
})

describe('drawTriangle', () => {
  it('draws one closed, filled triangle that spans the image', () => {
    const calls = []
    const ctx = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]) } })
    drawTriangle(ctx)
    expect(calls).toEqual([
      ['clearRect', 0, 0, TRI_W, TRI_H], ['beginPath'],
      ['moveTo', TRI_W / 2, 1], ['lineTo', TRI_W - 1, TRI_H - 2], ['lineTo', 1, TRI_H - 2], ['closePath'], ['fill'],
    ])
  })
})
