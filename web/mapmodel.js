// The pure half of the map (#465): what the MapLibre layers read, built from
// what the API answers. mapcore.js is the DOM/WebGL glue and stays out of the
// unit suite, the way huntmap.js does in the app; everything a test can pin
// lives here.
import { rssiTier, fillOpacity } from './signal.js'

const fc = (features) => ({ type: 'FeatureCollection', features })

// Zoom convention. MapLibre counts zoom against a 512 px world and Leaflet
// against 256 px, so the same scale is one level apart. The URL's ?z= and the
// server's hex binning (hexResForZoom, z in the /api/points and /api/heatmap
// queries) both grew up in Leaflet units; converting at the edge keeps every
// shared link and every cell the size it was.
export function leafletZoom(mapZoom) { return Math.round(Number(mapZoom) + 1) }
export function mapZoomFromLeaflet(z) { return Number(z) - 1 }

// One reception, one circle: tier colour and the tier's opacity, plus the
// index into the array it came from, which is how a click finds its point.
export function pointFeatures(points, colorOf) {
  const out = []
  points.forEach((pt, i) => {
    if (pt.lat == null || pt.lon == null) return
    const tier = rssiTier(pt.rssi)
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
      properties: { i, color: colorOf(tier), op: fillOpacity(tier) } })
  })
  return fc(out)
}

// The server's heatmap cells, restyled: the ring stays, the tier of the best
// RSSI decides the colour, and the count and hunter count ride along for the
// hover line. A withheld hunter list (a degraded caller, #440) is null, not 0.
export function hexFeatures(features, colorOf) {
  return fc((features || []).map((f, i) => {
    const tier = rssiTier(f.properties.best_rssi)
    return { type: 'Feature', geometry: f.geometry,
      properties: { i, color: colorOf(tier), op: fillOpacity(tier), best: f.properties.best_rssi, count: f.properties.count,
        hunters: Array.isArray(f.properties.hunters) ? f.properties.hunters.length : null } }
  }))
}

// CoreScope observer points: a relay (last-hop repeater) is a ring, an advert
// a dot, the same distinction the Leaflet layer drew.
export function observerFeatures(points, ring, colorOf) {
  return fc((points || []).map((pt, i) => {
    const tier = rssiTier(pt.rssi)
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
      properties: { i, color: colorOf(tier), ring: ring ? 1 : 0, op: ring ? 0.12 : fillOpacity(tier) } }
  }))
}

// Locate's observation points: inliers in their tier colour, outliers greyed.
export function locateFeatures(res, colorOf, noneColor) {
  const inliers = fc((res.inliers || []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { color: colorOf(rssiTier(p.rssi)), op: 0.7 } })))
  const outliers = fc((res.outliers || []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { color: noneColor, op: 0.2 } })))
  return { inliers, outliers }
}

// The density cloud, as bytes. Stops are [r,g,b] triples, warm to hot; the
// cold end is deliberately absent, since low density is not "cold signal" and
// a blue floor read as a halo around the hotspot. Cells below FLOOR stay fully
// transparent so the bounding rectangle never shows; above it alpha ramps to
// 210. Grid row 0 is south and image row 0 is north, hence the flip.
const FLOOR = 0.12
export function heatColor(v, stops) {
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  const a = stops[i], b = stops[i + 1]
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f))
}
export function heatImageData(grid, rows, cols, stops) {
  const data = new Uint8ClampedArray(rows * cols * 4)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c]
      const y = rows - 1 - r
      const idx = (y * cols + c) * 4
      const [cr, cg, cb] = heatColor(v, stops)
      data[idx] = cr; data[idx + 1] = cg; data[idx + 2] = cb
      data[idx + 3] = v < FLOOR ? 0 : Math.round(210 * (v - FLOOR) / (1 - FLOOR))
    }
  }
  return data
}

// MapLibre's image source wants the four corners, top-left first, clockwise.
export function imageCoordinates({ minLat, maxLat, minLon, maxLon }) {
  return [[minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]]
}

// [lat, lon] pairs to MapLibre's [[west, south], [east, north]]; null for none.
export function latLonBounds(latLons) {
  if (!latLons || !latLons.length) return null
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lat, lon] of latLons) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon
  }
  return [[minLon, minLat], [maxLon, maxLat]]
}

// The reach of a node (#549): the star of its direct hearings. The hub is the
// registry's advertised position when there is one and the RSSI estimate
// otherwise (Kasper, 2026-09-06); a 0,0 is no position (the §9 trap). One
// line per hearing, in that hearing's tier colour, so the star reads strong
// near the node and weak at its edge, and the hearings keep their own dots.
export function reachOrigin({ advertised, estimate } = {}) {
  const usable = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0)
  if (usable(advertised)) return { lat: advertised.lat, lon: advertised.lon, kind: 'advertised' }
  const c = estimate && estimate.centroid
  if (usable(c)) return { lat: c.lat, lon: c.lon, kind: 'estimate' }
  return null
}
export function reachFeatures(origin, points, colorOf) {
  if (!origin) return fc([])
  const out = []
  for (const pt of points || []) {
    if (pt.lat == null || pt.lon == null) continue
    const tier = rssiTier(pt.rssi)
    out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[origin.lon, origin.lat], [pt.lon, pt.lat]] },
      properties: { color: colorOf(tier), op: fillOpacity(tier), hub: origin.kind } })
  }
  return fc(out)
}
