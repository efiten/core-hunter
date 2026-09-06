// The pure half of the map (#465): what the MapLibre layers read, built from
// what the API answers. mapcore.js is the DOM/WebGL glue and stays out of the
// unit suite, the way huntmap.js does in the app; everything a test can pin
// lives here.
import { rssiTier, fillOpacity, extrusionHeight, withAlpha, pillarTint } from './signal.js'
import { octagonRing, pillarRadiusM, collapsePillars } from './pointmarker.js'
import { PITCH_3D } from './maplayers.js'

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
// height and pillar are only read by the 3D twin, hex-3d (#595), the app's
// rule (huntmap.js buildHexFC): the bar's height by tier, and the tint the
// bar is painted, the tier colour at the tier's opacity pre-mixed over the
// theme background (#412), opaque, so a bar reads as its own cell does.
export function hexFeatures(features, colorOf, background = '') {
  return fc((features || []).map((f, i) => {
    const tier = rssiTier(f.properties.best_rssi)
    const token = colorOf(tier)
    return { type: 'Feature', geometry: f.geometry,
      properties: { i, color: token, op: fillOpacity(tier), best: f.properties.best_rssi, count: f.properties.count,
        hunters: Array.isArray(f.properties.hunters) ? f.properties.hunters.length : null,
        pillar: pillarTint(tier, token, background), height: extrusionHeight(f.properties.best_rssi) } }
  }))
}

// The 3D twin of pointFeatures (#595), the app's buildPoints3DFC: an octagon
// footprint per reception, extruded to the same tier height as the hex bars,
// so a hotter reception stands taller. Tier opacity rides in the colour's
// alpha, since fill-extrusion-opacity is one number for the whole layer
// (#302). Coincident receptions collapse onto the strongest first (#402):
// coplanar side walls in one depth pass z-fight, and a stationary hunter's
// samples are exactly that. The footprint is metres, widened to a 4 px floor
// when the zoom would make 3 m a hairline (pointmarker.js).
const POINT_PILLAR_RADIUS_M = 3
const POINT_PILLAR_MIN_RADIUS_PX = 4
export function pillarFeatures(points, zoom, colorOf) {
  const placed = points.map((pt, i) => ({ ...pt, i })).filter((pt) => pt.lat != null && pt.lon != null)
  return fc(collapsePillars(placed).map((pt) => {
    const tier = rssiTier(pt.rssi)
    const ring = octagonRing(pt.lat, pt.lon, pillarRadiusM(pt.lat, zoom, POINT_PILLAR_RADIUS_M, POINT_PILLAR_MIN_RADIUS_PX))
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { i: pt.i, color: withAlpha(colorOf(tier), fillOpacity(tier)), height: extrusionHeight(pt.rssi) } }
  }))
}

// What the URL says about the camera (#595). ?view=3d is the layer state,
// and on its own it implies the app's fixed pitch (PITCH_3D); ?pitch= and
// ?bearing= are the camera itself and win when present, so a tilt or a turn
// the visitor chose survives the link. Clamped to what MapLibre accepts:
// pitch 0..85 (the app's MAX_PITCH), bearing wrapped into -180..180.
export function cameraFor({ view, pitch, bearing } = {}) {
  const view3D = view === '3d'
  const p = Number(pitch), b = Number(bearing)
  const hasPitch = pitch != null && pitch !== '' && Number.isFinite(p)
  const hasBearing = bearing != null && bearing !== '' && Number.isFinite(b)
  const wrapped = hasBearing ? ((((b + 180) % 360) + 360) % 360) - 180 : 0
  return { view3D, pitch: hasPitch ? Math.max(0, Math.min(85, p)) : (view3D ? PITCH_3D : 0), bearing: wrapped }
}

// A camera angle as it travels in the URL: whole degrees, and nothing at all
// for zero, so a flat north-up link stays as short as it was.
export function angleParam(deg) {
  const r = Math.round(Number(deg))
  return Number.isFinite(r) && r !== 0 ? String(r) : ''
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
