import { describe, it, expect } from 'vitest'
import { leafletZoom, mapZoomFromLeaflet, pointFeatures, hexFeatures, observerFeatures, locateFeatures, heatImageData, heatColor, imageCoordinates, latLonBounds } from './mapmodel.js'

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
    expect(fc.features[0].properties).toEqual({ i: 0, color: 'c-warm', op: 0.58, best: -85, count: 3, hunters: 2 })
  })
  it('reports no hunter count when the server withheld it', () => {
    const fc = hexFeatures([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[4, 51], [4, 51]]] }, properties: { best_rssi: -85, count: 3 } }], color)
    expect(fc.features[0].properties.hunters).toBeNull()
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

// #549: a node's reach is the star of its direct hearings, one line per
// reception in that reception's tier colour, from the node's position. The
// hub is the registry's advertised position when there is one, else the RSSI
// estimate (Kasper, 2026-09-06), and the line says which it hangs from.
import { reachFeatures, reachOrigin } from './mapmodel.js'

describe('reachOrigin', () => {
  it('takes the advertised position first, the estimate second, and nothing without either', () => {
    expect(reachOrigin({ advertised: { lat: 51, lon: 4 }, estimate: { centroid: { lat: 51.1, lon: 4.1 } } })).toEqual({ lat: 51, lon: 4, kind: 'advertised' })
    expect(reachOrigin({ advertised: null, estimate: { centroid: { lat: 51.1, lon: 4.1 } } })).toEqual({ lat: 51.1, lon: 4.1, kind: 'estimate' })
    expect(reachOrigin({ advertised: null, estimate: null })).toBeNull()
    expect(reachOrigin({ advertised: { lat: 0, lon: 0 }, estimate: null })).toBeNull()
  })
})

describe('reachFeatures', () => {
  const origin = { lat: 51, lon: 4, kind: 'advertised' }
  it('draws one line per hearing, from the hub, in the hearing\'s tier colour', () => {
    const fc = reachFeatures(origin, [{ lat: 51.01, lon: 4.02, rssi: -60 }, { lat: 50.99, lon: 3.98, rssi: -118 }], color)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[4, 51], [4.02, 51.01]] })
    expect(fc.features[0].properties).toEqual({ color: 'c-hot', op: 0.7, hub: 'advertised' })
    expect(fc.features[1].properties.color).toBe('c-faint')
  })
  it('skips a hearing without a position, and draws nothing without a hub', () => {
    expect(reachFeatures(origin, [{ lat: null, lon: 4, rssi: -60 }], color).features).toHaveLength(0)
    expect(reachFeatures(null, [{ lat: 51, lon: 4, rssi: -60 }], color).features).toHaveLength(0)
  })
})
