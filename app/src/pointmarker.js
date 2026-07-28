// Octagon footprint for a single reception's 3D "pillar" marker (#250) — the
// fill-extrusion twin of a flat point. Originally a square (#250); rounded to
// an octagon (#308) so the pillar reads as the same marker as the flat 2D
// circle it replaces instead of a visibly different shape between view modes.
// Meter-scale, so the small-angle approximation (flat-earth over a few
// metres, longitude scaled by cos(lat)) is exact enough; no need for
// hexgrid.js's full Mercator projection, which exists there to keep hex cells
// aligned to the server's shared grid — a per-point marker footprint has no
// such alignment requirement.
const EARTH_RADIUS_M = 6378137
const OCTAGON_SIDES = 8

// Returns a closed [lon, lat] ring (9 points) approximating a circle of
// `radiusM` metres, centered on (lat, lon).
export function octagonRing(lat, lon, radiusM) {
  const latRad = lat * Math.PI / 180
  const ring = []
  for (let i = 0; i <= OCTAGON_SIDES; i++) {
    const angle = (i % OCTAGON_SIDES) * (2 * Math.PI / OCTAGON_SIDES)
    const northM = radiusM * Math.cos(angle)
    const eastM = radiusM * Math.sin(angle)
    const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI)
    const dLon = (eastM / EARTH_RADIUS_M) * (180 / Math.PI) / Math.cos(latRad)
    ring.push([lon + dLon, lat + dLat])
  }
  return ring
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
//
// Returns a CIRCUMRADIUS (centre → vertex), which is what octagonRing consumes.
// The square this replaced (#250) took the same number as an apothem
// (centre → edge), so the octagon is narrower across the flats by
// cos(pi/8) = 0.9239 for the same argument: a 4 px floor is 3.70 px across the
// flats and the painted area is 2*sqrt(2)*r^2 rather than 4*r^2, i.e. 29% less.
// That is accepted deliberately (#308) rather than divided out — the pillar is
// a marker, not a measurement, and a slightly slimmer one reads better against
// the hex cells underneath. The names say radius so the next reader is not
// left thinking it means half-width.
export function pillarRadiusM(lat, zoom, baseM, minPx) {
  const floor = minPx * metresPerPixel(lat, zoom)
  return floor > baseM ? floor : baseM
}
