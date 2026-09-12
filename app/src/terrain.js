// Terrain (#293, #394, #396): the DEM source, the exaggeration steps, what
// the map draws for a terrain state, and the map's error listener.
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

// terrainPlan: what to draw for a terrain state. The 3D view is the switch
// on both the app and the map (Kasper, 2026-09-06: 3D takes the terrain and
// the exaggeration along at once). Hillshade follows it alone. The mesh
// (setTerrain) is what froze weak GPUs in #247 and makes easeTo({pitch}) a
// no-op, so it also waits for the DEM tiles having arrived (flat until then,
// Kasper 2026-09-05).
export function terrainPlan({ mode3D, ready, exaggeration } = {}) {
  const x = EXAGGERATION_STEPS.includes(Number(exaggeration)) ? Number(exaggeration) : DEFAULT_EXAGGERATION
  return { hillshade: !!mode3D, mesh: !!mode3D && !!ready, exaggeration: x }
}

// A DEM tile that fails to load is a tile that never arrives: the map stays
// flat rather than stalled, so it is not worth a console line per tile.
// MapLibre fires it with the tile, and the style adds the source id on the
// way up to the map; the DEM source's own load failure carries no tile.
export function isDemTileError(e) {
  return e.sourceId === 'dem' && !!e.tile
}

// reportMapError is the map's 'error' listener. Registering any listener
// takes away MapLibre's own console.error (Evented.fire logs only when
// nothing listens), for style, basemap and source errors alike, so this
// logs every error but a failed DEM tile the way MapLibre would.
export function reportMapError(e) {
  if (!isDemTileError(e)) console.error(e.error)
}
