import { describe, it, expect } from 'vitest'
import { leafletZoom, mapZoomFromLeaflet, pointFeatures, hexFeatures, pillarFeatures, observerFeatures, locateFeatures, heatImageData, heatColor, imageCoordinates, latLonBounds, cameraFor, angleParam } from './mapmodel.js'
import { PITCH_3D } from './maplayers.js'

// #465: the map moved from Leaflet to MapLibre, the app's map. These are the
// parts of the move that are pure: the GeoJSON the layers read, the heat image
// bytes, and the zoom convention the URL and the server keep from Leaflet.
const color = (tier) => `c-${tier}`

describe('zoom convention', () => {
  // MapLibre counts zoom against a 512 px world, Leaflet against 256 px, so the
  // same scale is one level apart. Shared links carry ?z= and the server bins
  // hex cells by z (hexResForZoom), both in Leaflet units; converting at the
  // edge keeps every existing link and the server's grid the size they were.
  it('adds one level for the URL and the server, and takes it back on the way in', () => {
    expect(leafletZoom(11)).toBe(12)
    expect(leafletZoom(11.4)).toBe(12)
    expect(mapZoomFromLeaflet(12)).toBe(11)
    expect(mapZoomFromLeaflet(leafletZoom(7))).toBe(7)
  })
})

describe('pointFeatures', () => {
  it('maps a reception to a point with its tier colour and opacity, and keeps its index', () => {
    const fc = pointFeatures([{ lat: 51, lon: 4, rssi: -60 }, { lat: 52, lon: 5, rssi: -120 }], color)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [4, 51] })
    expect(fc.features[0].properties).toEqual({ i: 0, color: 'c-hot', op: 0.7 })
    expect(fc.features[1].properties.color).toBe('c-faint')
    expect(fc.features[1].properties.i).toBe(1)
  })
  it('skips a reception without a position, keeping the index of the ones it draws', () => {
    const fc = pointFeatures([{ lat: null, lon: 4, rssi: -60 }, { lat: 52, lon: 5, rssi: -60 }], color)
    expect(fc.features.map((f) => f.properties.i)).toEqual([1])
  })
})

describe('hexFeatures', () => {
  it('keeps the server ring and carries the tier, the count and the hunters', () => {
    const ring = [[4, 51], [4.01, 51], [4.01, 51.01], [4, 51]]
    const fc = hexFeatures([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { best_rssi: -85, count: 3, hunters: ['a', 'b'] } }], color)
    expect(fc.features[0].geometry.coordinates[0]).toEqual(ring)
    expect(fc.features[0].properties).toEqual({ i: 0, color: 'c-warm', op: 0.58, best: -85, count: 3, hunters: 2, pillar: 'c-warm', height: 68 })
  })
  // #595: the 3D twin reads two more properties the flat layer ignores, the
  // app's (huntmap.js buildHexFC): the bar's height by tier, and the tint the
  // bar is painted, the tier colour at the tier's opacity over the background
  // (#412), so a bar reads as its own cell does.
  it('carries the bar height and the opaque pillar tint for the 3D twin', () => {
    const red = () => '#ff0000'
    const fc = hexFeatures([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[4, 51], [4, 51]]] }, properties: { best_rssi: -85, count: 1 } }], red, '#000000')
    expect(fc.features[0].properties.height).toBe(68)
    expect(fc.features[0].properties.pillar).toBe('#940000') // 255 * 0.58 over black
    const hot = hexFeatures([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[4, 51], [4, 51]]] }, properties: { best_rssi: -60, count: 1 } }], red, '#000000')
    expect(hot.features[0].properties.height).toBe(90)
    expect(hot.features[0].properties.pillar).toBe('#b30000') // 255 * 0.7
  })
  it('reports no hunter count when the server withheld it', () => {
    const fc = hexFeatures([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[4, 51], [4, 51]]] }, properties: { best_rssi: -85, count: 3 } }], color)
    expect(fc.features[0].properties.hunters).toBeNull()
  })
})

// #595: the 3D twin of the point layer, the app's (huntmap.js
// buildPoints3DFC): an octagon footprint per reception, extruded to the tier
// height, tier opacity riding in the colour's alpha (#302), coincident
// receptions collapsed to the strongest (#402).
describe('pillarFeatures', () => {
  const M = 1 / 111320
  const red = () => '#ff0000'
  it('draws an octagon per placed reception, with the tier height, the alpha in the colour and the source index', () => {
    const fc = pillarFeatures([{ lat: 51, lon: 4, rssi: -60 }, { lat: null, lon: 4, rssi: -60 }, { lat: 51.01, lon: 4, rssi: -120 }], 18, red)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry.type).toBe('Polygon')
    expect(fc.features[0].geometry.coordinates[0]).toHaveLength(9)
    expect(fc.features[0].properties).toEqual({ i: 0, color: 'rgba(255,0,0,0.7)', height: 90 })
    expect(fc.features[1].properties).toEqual({ i: 2, color: 'rgba(255,0,0,0.19)', height: 7 })
  })
  it('collapses receptions within 10 m onto the strongest, which keeps its own index', () => {
    const fc = pillarFeatures([{ lat: 51, lon: 4, rssi: -90 }, { lat: 51 + 5 * M, lon: 4, rssi: -60 }, { lat: 51 + 70 * M, lon: 4, rssi: -100 }], 18, red)
    expect(fc.features.map((f) => f.properties.i)).toEqual([1, 2])
  })
  it('widens the footprint when the zoom would make 3 m sub-pixel', () => {
    const spread = (fc) => Math.max(...fc.features[0].geometry.coordinates[0].map((c) => c[1])) - Math.min(...fc.features[0].geometry.coordinates[0].map((c) => c[1]))
    const near = pillarFeatures([{ lat: 51, lon: 4, rssi: -60 }], 18, red)
    const far = pillarFeatures([{ lat: 51, lon: 4, rssi: -60 }], 10, red)
    expect(spread(near)).toBeCloseTo(6 * M, 6)   // 3 m circumradius, true size
    expect(spread(far) / spread(near)).toBeGreaterThan(10) // the 4 px floor
  })
})

// #595: what the URL says about the camera. ?view=3d is the layer state and
// implies the app's fixed pitch; ?pitch= and ?bearing= are the camera itself
// and win when present, so a tilt the visitor chose survives the link.
describe('cameraFor', () => {
  it('reads 3D from the view and takes the fixed pitch when the URL has none', () => {
    expect(cameraFor({ view: '3d' })).toEqual({ view3D: true, pitch: PITCH_3D, bearing: 0 })
    expect(cameraFor({})).toEqual({ view3D: false, pitch: 0, bearing: 0 })
  })
  it('lets an explicit pitch and bearing win, clamped to what MapLibre accepts', () => {
    expect(cameraFor({ view: '3d', pitch: '45', bearing: '-30' })).toEqual({ view3D: true, pitch: 45, bearing: -30 })
    expect(cameraFor({ pitch: '99', bearing: '400' })).toEqual({ view3D: false, pitch: 85, bearing: 40 })
    expect(cameraFor({ pitch: 'x', bearing: '' })).toEqual({ view3D: false, pitch: 0, bearing: 0 })
  })
})

describe('angleParam', () => {
  it('rounds to whole degrees and leaves zero out of the URL', () => {
    expect(angleParam(15.6)).toBe('16')
    expect(angleParam(-30)).toBe('-30')
    expect(angleParam(0.4)).toBe('')
    expect(angleParam(0)).toBe('')
    expect(angleParam(NaN)).toBe('')
  })
})

describe('observerFeatures and locateFeatures', () => {
  it('draws a relay as a ring and an advert as a dot', () => {
    const pts = [{ lat: 51, lon: 4, rssi: -105 }]
    expect(observerFeatures(pts, true, color).features[0].properties).toEqual({ i: 0, color: 'c-cool', ring: 1, op: 0.12 })
    expect(observerFeatures(pts, false, color).features[0].properties).toEqual({ i: 0, color: 'c-cool', ring: 0, op: 0.34 })
  })
  it('colours inliers by tier and greys outliers', () => {
    const res = { inliers: [{ lat: 51, lon: 4, rssi: -60 }], outliers: [{ lat: 52, lon: 5, rssi: -60 }] }
    const { inliers, outliers } = locateFeatures(res, color, 'grey')
    expect(inliers.features[0].properties).toEqual({ color: 'c-hot', op: 0.7 })
    expect(outliers.features[0].properties).toEqual({ color: 'grey', op: 0.2 })
  })
})

describe('the heat image', () => {
  const stops = [[0, 0, 255], [255, 0, 0]]
  it('ramps colour across the stops', () => {
    expect(heatColor(0, stops)).toEqual([0, 0, 255])
    expect(heatColor(1, stops)).toEqual([255, 0, 0])
    expect(heatColor(0.5, stops)).toEqual([128, 0, 128])
  })
  it('leaves the floor transparent, flips rows so the south row is at the bottom, and caps alpha at 210', () => {
    // 2 rows x 1 col: grid row 0 is south, canvas y=0 is north.
    const data = heatImageData([0.05, 1], 2, 1, stops)
    expect(data.length).toBe(8)
    expect(data[3]).toBe(210)   // top pixel = grid row 1 = full density
    expect(data[7]).toBe(0)     // bottom pixel = grid row 0 = below the floor
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })
  it('puts the image corners in MapLibre order: top-left, top-right, bottom-right, bottom-left', () => {
    expect(imageCoordinates({ minLat: 51, maxLat: 52, minLon: 4, maxLon: 5 })).toEqual([[4, 52], [5, 52], [5, 51], [4, 51]])
  })
})

describe('latLonBounds', () => {
  it('fits a set of positions into a south-west / north-east pair', () => {
    expect(latLonBounds([[51, 4], [52, 3.5], [51.5, 5]])).toEqual([[3.5, 51], [5, 52]])
    expect(latLonBounds([])).toBeNull()
  })
})
