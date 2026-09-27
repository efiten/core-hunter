// Draws the "Repeaters heard" export (#666) from exportheard.js's model: a
// second MapLibre instance, offscreen at the fixed size, for the base map and
// the lines, then a canvas for the glyphs, the names and the band. The live
// map is untouched: only the offscreen one keeps its drawing buffer.
//
// The image is always the light theme, whatever the page shows: it is a
// picture on paper colours, passed on to people who never chose a theme.
//
// Canvas and MapLibre glue, verified in the browser and by the e2e export
// test; the rules it draws by are unit-tested in exportheard.test.js.
import { EXPORT_W, EXPORT_H, EXPORT_MAP_H, placeLabels, tint, scaleBar, fitText, reliefNote, tierLegend } from './exportheard.js'
import { DEM_TILES, DEM_ENCODING, DEM_MAX_ZOOM, DEM_ATTRIBUTION, DEFAULT_EXAGGERATION, hillshadeFor, reportMapError } from './terrain.js'
import { HUE_COUNT } from './coverage.js'
import { STYLES } from './mapcore.js'

export const EXPORT_STYLE = STYLES.light
const bareStyle = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] })
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// lightTokens reads the light theme's tokens off a probe that carries
// data-theme="light", so the colours come from style.css and nowhere else.
export function lightTokens(doc = document) {
  const probe = doc.createElement('div')
  probe.setAttribute('data-theme', 'light')
  probe.hidden = true
  doc.body.append(probe)
  const cs = getComputedStyle(probe)
  const get = (n) => cs.getPropertyValue(n).trim()
  const t = {
    bg: get('--ch-bg'), text: get('--ch-text'), muted: get('--ch-muted'), border: get('--ch-border'), accent: get('--ch-accent'),
    none: get('--ch-sig-none'), hot: get('--ch-sig-hot'), warm: get('--ch-sig-warm'), cool: get('--ch-sig-cool'),
    tiers: Object.fromEntries(['hot', 'warm', 'mid', 'cool', 'cold', 'faint'].map((t) => [t, get(`--ch-sig-${t}`)])),
    hues: Array.from({ length: HUE_COUNT }, (_, i) => get(`--ch-hue-${i}`)),
  }
  probe.remove()
  return t
}

// A promise for one map event, or for the time running out: an export must
// finish or fail, never hang on a tile that does not come.
const once = (map, ev, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms)
  map.once(ev, () => { clearTimeout(timer); resolve(true) })
})

const fc = (features) => ({ type: 'FeatureCollection', features })
const poly = (ring, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } })
const line = (coordinates, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } })
const dot = (lon, lat, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } })

// withMap runs `draw(map)` on an offscreen map in the light style and
// removes the map afterwards, however `draw` ends. The hosted style, or the
// bare ground when it cannot be had: the lines and the band still say what
// was heard.
async function withMap({ tokens, maplib, timeoutMs }, draw) {
  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:-${EXPORT_W * 10}px;top:0;width:${EXPORT_W}px;height:${EXPORT_MAP_H}px;pointer-events:none;`
  document.body.append(box)
  const map = new maplib.Map({
    container: box, style: EXPORT_STYLE, interactive: false, attributionControl: false,
    fadeDuration: 0, preserveDrawingBuffer: true, pixelRatio: 1,
  })
  // As on the live map: a DEM tile that does not arrive is not worth a
  // console line (terrain.js).
  map.on('error', reportMapError)
  try {
    if (!(await once(map, 'load', timeoutMs / 2))) {
      map.setStyle(bareStyle(tokens.bg))
      await once(map, 'styledata', timeoutMs / 2)
    }
    return await draw(map)
  } finally {
    map.remove()
    box.remove()
  }
}

// addRelief shades the terrain under the data, below `beforeId`, at the
// exaggeration from Settings, as the 3D view shades it (terrain.js). Called
// once the camera is on the subject, so no tile is fetched for the world
// view the map starts on.
function addRelief(map, exaggeration, beforeId) {
  map.addSource('dem', { type: 'raster-dem', tileSize: 256, maxzoom: DEM_MAX_ZOOM, encoding: DEM_ENCODING, tiles: [DEM_TILES] })
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': hillshadeFor(exaggeration) } }, beforeId)
}

// snapshot waits for the map to settle and starts the image with it: the
// paper ground, the map on top, and the scale bar and attribution over it.
async function snapshot(map, tokens, timeoutMs) {
  await once(map, 'idle', timeoutMs)
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = tokens.bg
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H)
  ctx.drawImage(map.getCanvas(), 0, 0, EXPORT_W, EXPORT_MAP_H)
  const c = map.getCenter()
  const mPerPx = 40075016.686 * Math.cos((c.lat * Math.PI) / 180) / (512 * 2 ** map.getZoom())
  return { canvas, ctx, bar: scaleBar(mPerPx) }
}

// renderHeardImage returns the finished 1200×1200 canvas.
// `text` is { title, sub, off }: the band's words, worked out by the caller;
// `exaggeration` is the relief's, from Settings.
export function renderHeardImage({ model, routes, cells, text, tokens, exaggeration = DEFAULT_EXAGGERATION, maplib = globalThis.maplibregl, timeoutMs = 20000 }) {
  const hue = (slot) => tokens.hues[slot] || tokens.text
  return withMap({ tokens, maplib, timeoutMs }, async (map) => {
    map.addSource('cells', { type: 'geojson', data: fc(cells.map(poly)) })
    map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: { 'fill-color': tokens.none, 'fill-opacity': 0.3 } })
    map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': tokens.none, 'line-width': 0.8, 'line-opacity': 0.8 } })
    map.addSource('route', { type: 'geojson', data: fc(routes.map((c) => line(c))) })
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': tokens.none, 'line-width': 2.5, 'line-opacity': 0.75 } })
    // Thin rays first, so a strong one is never drawn under a weak one.
    const rays = [], dots = []
    for (const s of model.drawn) {
      for (const r of s.rays) {
        const c = tint(hue(s.slot), r.s)
        rays.push(line([[s.origin.lon, s.origin.lat], [r.lon, r.lat]], { c, w: r.w * 0.6, op: r.op }))
        dots.push(dot(r.lon, r.lat, { c, v: r.rssi }))
      }
    }
    rays.sort((a, b) => a.properties.w - b.properties.w)
    dots.sort((a, b) => a.properties.v - b.properties.v)
    map.addSource('rays', { type: 'geojson', data: fc(rays) })
    map.addLayer({ id: 'rays', type: 'line', source: 'rays', paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } })
    map.addSource('dots', { type: 'geojson', data: fc(dots) })
    map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: { 'circle-color': ['get', 'c'], 'circle-radius': 2.6, 'circle-stroke-color': tokens.bg, 'circle-stroke-width': 0.7 } })

    // Fitted to what is drawn. The right edge keeps room for the names.
    if (model.drawn.length) {
      const o = model.drawn[0].origin
      const b = new maplib.LngLatBounds([o.lon, o.lat], [o.lon, o.lat])
      for (const s of model.drawn) { b.extend([s.origin.lon, s.origin.lat]); for (const r of s.rays) b.extend([r.lon, r.lat]) }
      map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 200 }, maxZoom: 14, animate: false })
    }
    addRelief(map, exaggeration, 'cells')
    const { canvas, ctx, bar } = await snapshot(map, tokens, timeoutMs)
    drawGlyphsAndNames(ctx, map, model, hue, tokens)
    drawMapFurniture(ctx, bar, tokens, exaggeration)
    const cols = [
      [String(model.numbers.repeaters), 'repeaters'],
      [String(model.numbers.receptions), 'receptions'],
      [`${model.numbers.farthestKm.toFixed(1)} km`, 'farthest'],
    ]
    heardLegend(ctx, drawBand(ctx, { ...text, cols }, tokens), tokens)
    return canvas
  })
}

// How strongly a heard cell is filled, by its tier: a strong cell reads
// first, a faint one stays a tint. The reference render's values.
const HEARD_OPACITY = { hot: 0.7, warm: 0.58, mid: 0.46, cool: 0.34, cold: 0.26, faint: 0.19 }

// renderReachImage (#720) returns the finished 1200×1200 canvas for one
// repeater: exportreach.js's model on the RSSI tiers, over the relief. The
// relief is exaggerated; the fill was checked against the real heights.
export function renderReachImage({ model, text, tokens, exaggeration = DEFAULT_EXAGGERATION, maplib = globalThis.maplibregl, timeoutMs = 20000 }) {
  const tierC = (t) => tokens.tiers[t] || tokens.none
  return withMap({ tokens, maplib, timeoutMs }, async (map) => {
    map.addSource('silent', { type: 'geojson', data: fc(model.silent.map((c) => poly(c.ring))) })
    map.addLayer({ id: 'silent', type: 'fill', source: 'silent', paint: { 'fill-color': tokens.none, 'fill-opacity': 0.32 } })
    map.addLayer({ id: 'silent-line', type: 'line', source: 'silent', paint: { 'line-color': tokens.none, 'line-width': 0.8, 'line-opacity': 0.8 } })
    // Filled in lighter than heard: what the repeater reaches, not what was
    // measured.
    map.addSource('filled', { type: 'geojson', data: fc(model.filled.map((c) => poly(c.ring, { c: tierC(c.tier) }))) })
    map.addLayer({ id: 'filled', type: 'fill', source: 'filled', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.3 } })
    map.addLayer({ id: 'filled-line', type: 'line', source: 'filled', paint: { 'line-color': tokens.bg, 'line-width': 0.8, 'line-opacity': 0.7 } })
    map.addSource('heard', { type: 'geojson', data: fc(model.heard.map((c) => poly(c.ring, { c: tierC(c.tier), a: HEARD_OPACITY[c.tier] || 0.3 }))) })
    map.addLayer({ id: 'heard', type: 'fill', source: 'heard', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['get', 'a'] } })
    map.addLayer({ id: 'heard-line', type: 'line', source: 'heard', paint: { 'line-color': ['get', 'c'], 'line-width': 1, 'line-opacity': 0.9 } })
    map.addSource('rays', { type: 'geojson', data: fc(model.rays.map((r) => line([[r.from.lon, r.from.lat], [r.lon, r.lat]], { c: tierC(r.tier) }))) })
    map.addLayer({ id: 'rays', type: 'line', source: 'rays', paint: { 'line-color': ['get', 'c'], 'line-width': 1.4, 'line-opacity': 0.75 } })
    const dots = model.dots.slice().sort((a, b) => a.rssi - b.rssi)
    map.addSource('dots', { type: 'geojson', data: fc(dots.map((d) => dot(d.lon, d.lat, { c: tierC(d.tier) }))) })
    map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: { 'circle-color': ['get', 'c'], 'circle-radius': 3.2, 'circle-stroke-color': tokens.bg, 'circle-stroke-width': 0.8 } })
    if (model.advertised && model.estimate) {
      map.addSource('offset', { type: 'geojson', data: line([[model.advertised.lon, model.advertised.lat], [model.estimate.lon, model.estimate.lat]]) })
      map.addLayer({ id: 'offset', type: 'line', source: 'offset', paint: { 'line-color': tokens.text, 'line-width': 1.5, 'line-dasharray': [2, 2] } })
    }
    const o = model.origin
    const b = new maplib.LngLatBounds([o.lon, o.lat], [o.lon, o.lat])
    for (const d of model.dots) b.extend([d.lon, d.lat])
    if (model.estimate) b.extend([model.estimate.lon, model.estimate.lat])
    map.fitBounds(b, { padding: 80, maxZoom: 14, animate: false })
    addRelief(map, exaggeration, 'silent')

    const { canvas, ctx, bar } = await snapshot(map, tokens, timeoutMs)
    drawPositions(ctx, map, model, tokens)
    drawMapFurniture(ctx, bar, tokens, exaggeration)
    const cols = [
      [String(model.numbers.receptions), 'receptions'],
      [`${model.numbers.strongest} dBm`, 'strongest'],
      [`${model.numbers.farthestKm.toFixed(1)} km`, 'farthest'],
    ]
    reachLegend(ctx, drawBand(ctx, { ...text, cols }, tokens), tokens)
    return canvas
  })
}

// The ▲ labelled "adv." at the advertised position and the ● labelled
// "est." at the RSSI estimate; without an advertised position the ● is
// where the rays start.
function drawPositions(ctx, map, model, tokens) {
  ctx.save()
  ctx.font = `14px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  if (model.advertised) {
    const p = map.project([model.advertised.lon, model.advertised.lat])
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x + 10, p.y + 8); ctx.lineTo(p.x - 10, p.y + 8); ctx.closePath()
    ctx.fillStyle = tokens.text; ctx.strokeStyle = tokens.bg; ctx.lineWidth = 2
    ctx.fill(); ctx.stroke()
    halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText('adv.', p.x + 14, p.y) : ctx.fillText('adv.', p.x + 14, p.y)))
  }
  if (model.estimate) {
    const p = map.project([model.estimate.lon, model.estimate.lat])
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
    ctx.fillStyle = tokens.text; ctx.strokeStyle = tokens.bg; ctx.lineWidth = 2
    ctx.fill(); ctx.stroke()
    ctx.textAlign = 'right'
    halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText('est.', p.x - 12, p.y) : ctx.fillText('est.', p.x - 12, p.y)))
  }
  ctx.restore()
}

// A halo in the paper's colour (tokens.bg) under text or a glyph, so it
// stays legible over the map. No colour of its own: the picture is on paper.
function halo(ctx, paper, draw) {
  ctx.save()
  ctx.strokeStyle = paper
  ctx.globalAlpha = 0.95
  ctx.lineWidth = 3.5
  ctx.lineJoin = 'round'
  draw('stroke')
  ctx.restore()
  draw('fill')
}

// The ▲ at an advertised position, the ● at an estimate, in the star's hue;
// then the names that fit (placeLabels), in the same hue on a white halo.
function drawGlyphsAndNames(ctx, map, model, hue, tokens) {
  const at = model.drawn.map((s) => ({ s, p: map.project([s.origin.lon, s.origin.lat]) }))
  for (const { s, p } of at) {
    ctx.beginPath()
    if (s.origin.kind === 'advertised') { ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x + 8, p.y + 6); ctx.lineTo(p.x - 8, p.y + 6); ctx.closePath() }
    else ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
    ctx.fillStyle = hue(s.slot)
    ctx.strokeStyle = tokens.bg
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    ctx.fill()
    ctx.stroke()
  }
  ctx.font = `600 14px ${FONT}`
  ctx.textBaseline = 'middle'
  const kept = placeLabels(at.map(({ s, p }) => ({ id: s.id, x: p.x, y: p.y, label: s.name, n: s.n })),
    { measure: (t) => ctx.measureText(t).width, width: EXPORT_W, height: EXPORT_MAP_H })
  for (const { s, p } of at) {
    if (!kept.has(s.id)) continue
    ctx.fillStyle = hue(s.slot)
    halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText(s.name, p.x + 12, p.y) : ctx.fillText(s.name, p.x + 12, p.y)))
  }
  ctx.textBaseline = 'alphabetic'
}

// The scale bar, with how much the relief is exaggerated beside it, and the
// attribution over the map, the terrain tiles' included.
function drawMapFurniture(ctx, bar, tokens, exaggeration) {
  const y = EXPORT_MAP_H - 16
  ctx.save()
  ctx.strokeStyle = tokens.text
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(20, y - 6); ctx.lineTo(20, y); ctx.lineTo(20 + bar.px, y); ctx.lineTo(20 + bar.px, y - 6)
  ctx.stroke()
  ctx.font = `13px ${FONT}`
  ctx.fillStyle = tokens.text
  halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText(bar.label, 20, y - 12) : ctx.fillText(bar.label, 20, y - 12)))
  const note = reliefNote(exaggeration)
  if (note) halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText(note, 32 + bar.px, y + 4) : ctx.fillText(note, 32 + bar.px, y + 4)))
  const attr = `© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors · ${DEM_ATTRIBUTION}`
  ctx.font = `11px ${FONT}`
  ctx.fillStyle = tokens.muted
  ctx.textAlign = 'right'
  halo(ctx, tokens.bg, (how) => (how === 'stroke' ? ctx.strokeText(attr, EXPORT_W - 12, EXPORT_MAP_H - 8) : ctx.fillText(attr, EXPORT_W - 12, EXPORT_MAP_H - 8)))
  ctx.restore()
}

// The brand mark (web/icon.svg's shape), drawn at 20 px.
function drawMark(ctx, x, y, tokens) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(20 / 512, 20 / 512)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = tokens.accent
  ctx.lineWidth = 26
  ctx.beginPath()
  ;[[424, 256], [340, 111], [172, 111], [88, 256], [172, 401], [340, 401]].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
  ctx.closePath()
  ctx.stroke()
  ctx.lineWidth = 30
  const arcs = (r, colour) => {
    const a = Math.atan2(88 * r / 112, 70 * r / 112)
    ctx.strokeStyle = colour
    ctx.beginPath(); ctx.arc(256, 256, r, -a, a); ctx.stroke()
    ctx.beginPath(); ctx.arc(256, 256, r, Math.PI - a, Math.PI + a); ctx.stroke()
  }
  arcs(112, tokens.cool)
  arcs(68, tokens.warm)
  ctx.fillStyle = tokens.hot
  ctx.beginPath(); ctx.arc(256, 256, 52, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// The band under the map: the mark and the site, the title, the window and
// the hunters, what was left off, and three numbers as [number, word] pairs.
// Returns the baseline the legend starts on; each export draws its own.
function drawBand(ctx, { title, sub, off, cols }, tokens) {
  const top = EXPORT_MAP_H
  const L = 44, R = EXPORT_W - 44
  ctx.save()
  ctx.fillStyle = tokens.bg
  ctx.fillRect(0, top, EXPORT_W, EXPORT_H - top)
  ctx.fillStyle = tokens.border
  ctx.fillRect(0, top, EXPORT_W, 1)
  drawMark(ctx, L, top + 23, tokens)
  ctx.fillStyle = tokens.text
  ctx.font = `700 15px ${FONT}`
  ctx.fillText('mesh-hunter.eu', L + 30, top + 39)
  ctx.font = `700 36px ${FONT}`
  ctx.fillText(title, L, top + 92)
  ctx.fillStyle = tokens.muted
  ctx.font = `16px ${FONT}`
  ctx.fillText(sub, L, top + 120)
  let y = top + 146
  if (off) {
    ctx.font = `14px ${FONT}`
    ctx.fillText(fitText(off, R - L, (t) => ctx.measureText(t).width), L, top + 142)
    y = top + 170
  }
  // Three numbers, right-aligned as a group, each centred over its word.
  const widths = cols.map(([num, lab]) => {
    ctx.font = `700 34px ${FONT}`; const a = ctx.measureText(num).width
    ctx.font = `15px ${FONT}`; const b = ctx.measureText(lab).width
    return Math.max(a, b)
  })
  let x = R
  ctx.textAlign = 'center'
  for (let i = cols.length - 1; i >= 0; i--) {
    const mid = x - widths[i] / 2
    ctx.fillStyle = tokens.text
    ctx.font = `700 34px ${FONT}`
    ctx.fillText(cols[i][0], mid, top + 88)
    ctx.fillStyle = tokens.muted
    ctx.font = `15px ${FONT}`
    ctx.fillText(cols[i][1], mid, top + 110)
    x -= widths[i] + 44
  }
  ctx.textAlign = 'left'
  ctx.restore()
  return y
}

// A hex swatch for a legend, 14×16, its top at y - 12.
function hexSwatch(ctx, x, y, colour, alpha) {
  ctx.save()
  ctx.fillStyle = colour
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ;[[7, 0], [14, 4], [14, 12], [7, 16], [0, 12], [0, 4]].forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y - 12 + py) : ctx.moveTo(x + px, y - 12 + py)))
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

// Repeaters heard: a ▲ with a strong and a weak ray, the route, a mapped
// cell and the ● of an estimate.
function heardLegend(ctx, y, tokens) {
  const L = 44
  ctx.save()
  ctx.font = `13px ${FONT}`
  ctx.fillStyle = tokens.muted
  let lx = L
  const hue0 = tokens.hues[0]
  ctx.lineCap = 'round'
  ctx.strokeStyle = hue0; ctx.lineWidth = 2.2
  ctx.beginPath(); ctx.moveTo(lx + 5, y - 5); ctx.lineTo(lx + 38, y - 9); ctx.stroke()
  ctx.strokeStyle = tint(hue0, 0); ctx.lineWidth = 0.9
  ctx.beginPath(); ctx.moveTo(lx + 5, y - 5); ctx.lineTo(lx + 36, y + 2); ctx.stroke()
  ctx.fillStyle = hue0
  ctx.beginPath(); ctx.moveTo(lx + 5, y - 11); ctx.lineTo(lx + 10, y - 2); ctx.lineTo(lx, y - 2); ctx.closePath(); ctx.fill()
  ctx.fillStyle = tokens.muted
  const say = (t) => { ctx.fillText(t, lx, y); lx += ctx.measureText(t).width + 18 }
  lx += 46
  say('a repeater in its own colour, a line to every place it was heard: strong full and thick, weak light and thin')
  hexSwatch(ctx, lx, y, tokens.none, 0.45)
  lx += 20
  ctx.fillStyle = tokens.muted
  say('mapped')
  ctx.strokeStyle = tokens.none; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(lx, y - 5); ctx.lineTo(lx + 26, y - 5); ctx.stroke()
  lx += 32
  say('route')
  ctx.fillStyle = tokens.text
  ctx.beginPath(); ctx.arc(lx + 5, y - 5, 5, 0, Math.PI * 2); ctx.fill()
  lx += 16
  ctx.fillStyle = tokens.muted
  say('estimated position (RSSI)')
  ctx.restore()
}


// Reach of one repeater: the RSSI tiers on the first row; mapped not heard,
// the ▲ and the ● on the second. No route, and no line for the filled-in
// cells: where the hunters drove shows in the heard and the mapped cells,
// and the lighter cells speak for themselves (Kasper, 27 September).
function reachLegend(ctx, y, tokens) {
  let lx = 44
  ctx.save()
  ctx.font = `13px ${FONT}`
  ctx.fillStyle = tokens.muted
  const say = (t, gap = 14) => { ctx.fillStyle = tokens.muted; ctx.fillText(t, lx, y); lx += ctx.measureText(t).width + gap }
  say('RSSI')
  for (const [tier, label] of tierLegend()) {
    ctx.fillStyle = tokens.tiers[tier]
    ctx.beginPath(); ctx.arc(lx + 6, y - 5, 6, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = tokens.bg; ctx.lineWidth = 1.5; ctx.stroke()
    lx += 17
    say(label)
  }
  say('dBm')
  y += 26
  lx = 44
  hexSwatch(ctx, lx, y, tokens.none, 0.45)
  lx += 20
  say('mapped, not heard', 18)
  ctx.fillStyle = tokens.text
  ctx.beginPath(); ctx.moveTo(lx + 6, y - 11); ctx.lineTo(lx + 12, y); ctx.lineTo(lx, y); ctx.closePath(); ctx.fill()
  lx += 18
  say('advertised position', 18)
  ctx.fillStyle = tokens.text
  ctx.beginPath(); ctx.arc(lx + 5, y - 5, 5, 0, Math.PI * 2); ctx.fill()
  lx += 16
  say('estimated position (RSSI)')
  ctx.restore()
}
