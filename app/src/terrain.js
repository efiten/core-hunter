// Terrain (#293, #394, #396): the DEM source, the exaggeration steps, and
// what the map draws for a terrain state.
//
// Decided 2026-08-21 (#394): terrain ships on the AWS Open Data terrarium
// tiles, key-free, attribution required. The DEM is capped at z10, the
// low-poly knob measured in #335 (127 KB per z14 screen, against 74 KB at
// z8 and a freeze at full resolution in #247): MapLibre overzooms one parent
// tile instead of fetching the children, so the mesh is coarser and the
// requests far fewer. For RF work the useful signal is the landform that
// blocks a path, not metre-scale detail.
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const DEM_ENCODING = 'terrarium'
export const DEM_MAX_ZOOM = 10
export const DEM_ATTRIBUTION = 'DEM: Mapzen / AWS Open Data'

// The exaggeration defaults to 7, deliberately high, and should not be
// "corrected" later: the terrain this has to show is the Netherlands and
// northern Belgium, where a realistic 1-2x shows nothing at all. 1x is not a
// cosmetic minimum: it is the only step where a line-of-sight read is
// literally true. Discrete steps rather than a slider, for a thumb while
// driving (#396).
export const EXAGGERATION_STEPS = [1, 2, 4, 7, 10]
export const DEFAULT_EXAGGERATION = 7

// Shading tracks the geometry, so the two never disagree about the same
// hill (#396). MapLibre's hillshade-exaggeration is 0..1: 10x is the full
// shade, 1x a tenth of it.
export function hillshadeFor(exaggeration) {
  const x = Number(exaggeration)
  const v = Number.isFinite(x) ? x / 10 : 0.1
  return Math.min(1, Math.max(0.1, v))
}

// terrainPlan: what to draw for a terrain state. `on` is the surface's
// switch: the 3D view itself on both the app and the map (Kasper,
// 2026-09-06: 3D takes the terrain and the exaggeration along at once).
// Hillshade follows it alone. The mesh (setTerrain) is what froze weak GPUs
// in #247 and makes easeTo({pitch}) a no-op, so it waits for three things:
// the switch, the DEM tiles having arrived (flat until then, Kasper
// 2026-09-05), and a 3D view, the only one where displacement can be seen.
export function terrainPlan({ on, ready, mode3D, exaggeration } = {}) {
  const x = EXAGGERATION_STEPS.includes(Number(exaggeration)) ? Number(exaggeration) : DEFAULT_EXAGGERATION
  return { hillshade: !!on, mesh: !!on && !!ready && !!mode3D, exaggeration: x }
}
