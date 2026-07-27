// Small square footprint for a single reception's 3D "pillar" marker (#250) —
// the fill-extrusion twin of a flat point. Meter-scale, so the small-angle
// approximation (flat-earth over a few metres, longitude scaled by cos(lat))
// is exact enough; no need for hexgrid.js's full Mercator projection, which
// exists there to keep hex cells aligned to the server's shared grid — a
// per-point marker footprint has no such alignment requirement.
const EARTH_RADIUS_M = 6378137

// Returns a closed [lon, lat] ring (5 points) for a square centered on
// (lat, lon), `halfWidthM` metres from center to edge.
export function squareRing(lat, lon, halfWidthM) {
  const dLat = (halfWidthM / EARTH_RADIUS_M) * (180 / Math.PI)
  const dLon = dLat / Math.cos(lat * Math.PI / 180)
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ]
}

// MapLibre's zoom is defined against a 512 px world at z0, so ground resolution
// is (equatorial circumference x cos(lat)) / (512 x 2^zoom).
const EQUATOR_M = 2 * Math.PI * EARTH_RADIUS_M
export function metresPerPixel(lat, zoom) {
  return (EQUATOR_M * Math.cos(lat * Math.PI / 180)) / (512 * Math.pow(2, zoom))
}

// A pillar is a real-world object, so its footprint is metres — but a fixed
// metre size goes sub-pixel when zoomed out (~1 px at z14, which is the map's
// own initial zoom), leaving a hairline that cannot be seen or tapped. The flat
// circles these replace were zoom-invariant. Keep the true size where it is
// legible and only widen once it would fall below `minPx` on screen.
export function pillarHalfWidthM(lat, zoom, baseM, minPx) {
  const floor = minPx * metresPerPixel(lat, zoom)
  return floor > baseM ? floor : baseM
}
