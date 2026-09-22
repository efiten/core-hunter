// The node-position layer's glyphs as GL features (#632): the ▲ at a node's
// advertised position with its name, the ● at our estimate, and the ● hub a
// reach star hangs from when the registry has no position for it.
//
// They were DOM markers (maplibregl.Marker). A marker is not a map layer: it
// is positioned in screen space by JS on every move, so it floated over the
// 3D scene at no elevation, on top of the pillars it should stand among, and
// on a phone it could lag the canvas by a frame while a gesture ran (#622).
// A symbol layer and a circle layer are drawn by the map itself, elevated by
// the terrain like everything else, and a circle is depth-tested against the
// extrusions, so a hub behind a pillar is behind it.
//
// This IS the app's verbatim copy of web/nodeglyphs.js: neither deploy path
// can ship a file outside its own directory (#238), so the copies stay and
// web/parity.test.js pins them. What differs per surface is in the caller.
//
// Sources: `nodeglyphs` holds the ▲ features, `nodedots` the ● ones. Layers:
// `node-adverts` (symbol) and `node-dots` (circle), placed by LAYER_ORDER.

export const NODE_GLYPH_SOURCE = 'nodeglyphs'
export const NODE_DOT_SOURCE = 'nodedots'
export const NODE_ADVERT_LAYER = 'node-adverts'
export const NODE_DOT_LAYER = 'node-dots'
export const NODE_GLYPH_LAYERS = [NODE_DOT_LAYER, NODE_ADVERT_LAYER]

// A dimmed glyph steps back with its star (#624), the same 0.35 the DOM
// markers wore as .np-dim.
export const DIM_OPACITY = 0.35

// The tap box: 30px around the glyph, the same box the markers carried as a
// ::after (#539). 30 rather than 44 deliberately: a marker swallowed the pan
// that started on it, and 33 markers x 44px turned a dense cluster into a
// patch of map that could not be dragged. A layer never swallows a pan, so
// the box could grow now; kept at 30 until that is a measured wish.
export const HIT_HALF_PX = 15

// The ▲ image, an SDF so icon-color paints it per feature. Drawn at 2x for a
// 14x16 CSS px glyph, the size .np-advert had. Takes a 2D context so the
// drawing is testable without a canvas; the caller makes the canvas.
export const TRI_IMAGE = 'np-tri'
export const TRI_W = 28
export const TRI_H = 32
export function drawTriangle(ctx) {
  ctx.clearRect(0, 0, TRI_W, TRI_H)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(TRI_W / 2, 1)
  ctx.lineTo(TRI_W - 1, TRI_H - 2)
  ctx.lineTo(1, TRI_H - 2)
  ctx.closePath()
  ctx.fill()
}

const point = (lon, lat, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } })

// The ▲ of one node. `label` is '' when the declutter dropped the name (#425);
// the layer prints nothing for it and MapLibre's own collision is off, so the
// declutter stays the one thing that decides. `color` is the star's hue while
// the reach is on, the text colour otherwise; `selected` makes the name a
// heavier one in a thicker surface-coloured halo, what the pill was.
export function advertFeature({ key, lon, lat, label = '', color, selected = false, dim = false }) {
  return point(lon, lat, { kind: 'advert', key: String(key).toLowerCase(), label: String(label || ''), color, sel: !!selected, op: dim ? DIM_OPACITY : 1 })
}

// A ● : the estimate of a node (`estimate`, in the hot signal colour), or the
// hub of a star with no registry position (`hub`, in the star's hue). `key`
// is what a tap selects: the node's pubkey, or the star's id.
export function dotFeature({ key, kind, lon, lat, color, dim = false }) {
  return point(lon, lat, { kind, key: String(key).toLowerCase(), color, op: dim ? DIM_OPACITY : 1 })
}

export const EMPTY_FC = { type: 'FeatureCollection', features: [] }
export const fc = (features) => ({ type: 'FeatureCollection', features })

// The two layers, with the theme's colours baked in: paint properties cannot
// read a CSS variable, so the caller re-adds the layers on a theme swap, as it
// does for every other overlay. `font` is a font stack the style has glyphs
// for (OpenFreeMap serves Noto Sans).
export function nodeGlyphLayers({ text, bg, surface, font = ['Noto Sans Regular'] }) {
  return [
    { id: NODE_DOT_LAYER, type: 'circle', source: NODE_DOT_SOURCE,
      paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': bg,
        'circle-opacity': ['get', 'op'], 'circle-stroke-opacity': ['get', 'op'] } },
    { id: NODE_ADVERT_LAYER, type: 'symbol', source: NODE_GLYPH_SOURCE,
      layout: { 'icon-image': TRI_IMAGE, 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['get', 'label'], 'text-font': font, 'text-size': ['case', ['get', 'sel'], 12, 11],
        'text-anchor': 'left', 'text-offset': [1, 0], 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-max-width': 40 },
      paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': bg, 'icon-halo-width': 1, 'icon-opacity': ['get', 'op'],
        'text-color': ['get', 'color'], 'text-halo-color': ['case', ['get', 'sel'], surface, bg],
        'text-halo-width': ['case', ['get', 'sel'], 2.5, 1.2], 'text-halo-blur': ['case', ['get', 'sel'], 0, 0.5],
        'text-opacity': ['get', 'op'] } },
  ].map((l) => ({ ...l, layout: { ...(l.layout || {}) } }))
}

// The glyph a tap lands on: the nearest of the features inside the tap box,
// so a ● beside a ▲ gets the tap that is closer to it. `features` come from
// queryRenderedFeatures over the box; `project` maps a feature's coordinate
// to screen px. null when the box is empty.
export function nearestGlyph(features, tap, project) {
  let best = null, bestD = Infinity
  for (const f of features || []) {
    const c = f.geometry && f.geometry.coordinates
    if (!c) continue
    const p = project(c)
    const d = Math.hypot(p.x - tap.x, p.y - tap.y)
    if (d < bestD) { bestD = d; best = f }
  }
  return best
}

// The box queryRenderedFeatures is asked about for a tap at `p`.
export function hitBox(p, half = HIT_HALF_PX) {
  return [[p.x - half, p.y - half], [p.x + half, p.y + half]]
}
