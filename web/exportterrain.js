// The ground under the reach export (#720): the Terrarium tiles the map's 3D
// view draws (terrain.js), fetched at the same zoom and read pixel by pixel,
// so exportreach.js can ask how high the ground is anywhere near one
// repeater. At zoom 10 a pixel is about 95 m: the landform that blocks a
// path, not the house in front of the antenna.
import { DEM_TILES, DEM_MAX_ZOOM } from './terrain.js'

// A star spread over more tiles than this, 8 by 8 at zoom 10 or about
// 200 km across, is not one repeater's reach: its ground is not fetched.
export const MAX_TILES = 64
const TILE = 256

// terrariumElevation: a Terrarium pixel in metres.
export function terrariumElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768
}

// tilePixel: the slippy-map tile at zoom `z` a place falls in, and the pixel
// of its 256×256 image.
export function tilePixel(lat, lon, z) {
  const n = 2 ** z
  const fx = ((lon + 180) / 360) * n
  const rad = (lat * Math.PI) / 180
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  const x = Math.floor(fx), y = Math.floor(fy)
  return { x, y, px: Math.floor((fx - x) * TILE), py: Math.floor((fy - y) * TILE) }
}

// tilesFor: the zoom-`z` tiles under the box around `places`, padded by
// `padDeg` so a cell at its edge has ground under it too.
export function tilesFor(places, z = DEM_MAX_ZOOM, padDeg = 0.01) {
  const lats = places.map((p) => p.lat), lons = places.map((p) => p.lon)
  const nw = tilePixel(Math.max(...lats) + padDeg, Math.min(...lons) - padDeg, z)
  const se = tilePixel(Math.min(...lats) - padDeg, Math.max(...lons) + padDeg, z)
  const out = []
  for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) out.push({ z, x, y })
  return out
}

// elevationFrom: elevationAt(lat, lon) over decoded tiles, a Map from
// "x/y" to their 256×256 RGBA pixels. Null off the tiles: ground that was
// not read.
export function elevationFrom(tiles, z = DEM_MAX_ZOOM) {
  return (lat, lon) => {
    const t = tilePixel(lat, lon, z)
    const px = tiles.get(`${t.x}/${t.y}`)
    if (!px) return null
    const i = (t.py * TILE + t.px) * 4
    return terrariumElevation(px[i], px[i + 1], px[i + 2])
  }
}

// loadTerrain: elevationAt for the ground under `places`, or null when it
// cannot all be read: a tile that does not arrive, or a browser that alters
// what a canvas reads back (Brave, Firefox against fingerprinting), where
// one bit of red off is 256 m of ground. The export then fills along the
// lines alone rather than leave holes where a tile is missing.
// A DEM host that does not answer must not hold the export on "Drawing the
// map…": a tile that takes longer counts as missing, and the export fills
// along the lines alone.
export const TILE_TIMEOUT_MS = 8000
export async function loadTerrain(places) {
  const want = tilesFor(places)
  if (want.length > MAX_TILES || canvasAltered()) return null
  const tiles = new Map()
  await Promise.all(want.map(async ({ z, x, y }) => {
    try {
      const res = await fetch(DEM_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) })
      if (!res.ok) return
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      const ctx = context(TILE)
      ctx.drawImage(bmp, 0, 0)
      tiles.set(`${x}/${y}`, ctx.getImageData(0, 0, TILE, TILE).data)
    } catch (_) { /* counted below */ }
  }))
  return tiles.size === want.length ? elevationFrom(tiles) : null
}

// MapLibre's own test for it (isOffscreenCanvasDistorted): paint known
// bytes, read them back.
function canvasAltered() {
  const n = 5
  const ctx = context(n)
  for (let i = 0; i < n * n; i++) {
    ctx.fillStyle = `rgb(${i * 4},${i * 4 + 1},${i * 4 + 2})`
    ctx.fillRect(i % n, Math.floor(i / n), 1, 1)
  }
  return ctx.getImageData(0, 0, n, n).data.some((v, i) => i % 4 !== 3 && v !== i)
}
function context(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c.getContext('2d', { willReadFrequently: true })
}
