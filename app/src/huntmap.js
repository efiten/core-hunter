import { hexCellAt, hexBoundary, hexResForZoom } from './hexgrid.js'
import { rssiTier, tierColorVar, fillOpacity, effectivePlotOffset, ageFade, extrusionHeight, withAlpha, pillarTint, EXTRUSION_LIGHT_INTENSITY } from './signal.js'
import { getConfig } from './config.js'
import { nodesInView, driftPresentation, groupSenderPointsForNodes, estimateFor, circleRing } from './nodelayer.js'
import { unclutteredLabels, createLabelMeasurer } from './nodelabels.js'
import { appendTrailPoint } from './trail.js'
import { packetTypeLabel } from './filters.js'
import { layerVisibility, pitchTransition } from './maplayers.js'
import { octagonRing, pillarRadiusM, collapsePillars } from './pointmarker.js'
import { recordsKey, lastValueCache } from './rendercache.js'
import { skyForHour, currentHour } from './sky.js'

// Map layer — MapLibre GL (#147). Migrated from Leaflet + leaflet-rotate: native
// rotation/pitch replaces the plugin (and its zoom-drift patch, #167/#168), and
// a vector basemap (OpenFreeMap) unlocks 3D buildings in the follow-up
// 3D phase. The createHuntMap(...) API is unchanged so app.js stays as-is.

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// OpenFreeMap hosted vector styles (key-free); both use the "openmaptiles"
// vector source. --ch-basemap ('dark'|'light') is the app's theme hint.
const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}
const EMPTY = { type: 'FeatureCollection', features: [] }
const fc = (features) => ({ type: 'FeatureCollection', features })
// Bare background-only style — loads with no network, so the signal overlays
// can mount on it when the hosted basemap style is unreachable (see below).
const bareStyle = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] })

// 3D mode (#147 phase 2): setView() tilts the camera (pitchTransition,
// maplayers.js) and swaps the flat hex layer for its fill-extrusion twin —
// same 'hex' source, height added per feature (extrusionHeight). Buildings
// reuse the OpenFreeMap style's own "openmaptiles"/"building" source, already
// fetched for the 2D basemap, so 3D adds no new data request. (Terrain was
// dropped — see docs/2026-07-11-3d-mode.md: its AWS DEM tiles kept the map in
// a perpetual load loop and froze weaker GPUs.)

// Ceiling for the two-finger tilt gesture (#333). MapLibre's own default
// maxPitch is 60 — the same value the FAB eases to (PITCH_3D, maplayers.js) —
// so without this the gesture bottomed out exactly where the FAB left off and
// the camera could never look along the ground. 85 is MapLibre's hard maximum
// (86+ throws "maxPitch must be less than or equal to 85"); 90 is not offered
// because a camera level with the horizon projects to infinity.
// PITCH_3D deliberately stays 60: the FAB is the introduction to 3D, and the
// gesture is what takes you the rest of the way. Those two compose because
// setView() only eases when a tap crosses the 2D/3D line (pitchTransition) --
// cycling between 3D states leaves a gesture-set angle where it is, and
// leaving 3D is what puts the camera back to a known one.
const MAX_PITCH = 85
// Points-in-3D (#250): a small standing "pillar" per reception, same tier
// height/colour as hex-3d's bars, so it reads clearly in the tilted view
// instead of disappearing under the hex/building geometry (a flat circle
// layer can't be raised — MapLibre circles always sit on the ground plane).
const POINT_PILLAR_RADIUS_M = 3
// Minimum on-screen RADIUS (centre -> vertex), not half-width: keeps the
// footprint off sub-pixel when zoomed out (#250). Across the flats that is
// 4 x cos(pi/8) = 3.70 px, deliberately slimmer than the old square (#308).
const POINT_PILLAR_MIN_RADIUS_PX = 4

export function createHuntMap(containerId) {
  const stub = { setPosition() {}, centerOn() {}, recenter() {}, onFollowChange() {}, render() {}, setView() {}, applyBasemap() {}, focusReception() {}, setAttenuator() {}, setTimeWindow() {}, setBearing() {}, onGestureRotate() {}, setHighlight() {}, onMarkerFocus() {}, setNodePositions() {}, setNodeLayerVisible() {}, destroy() {} }
  // Degrade to a no-op map (never throw during app init) when MapLibre's CDN
  // script failed, or when WebGL is unavailable — GPU blocklist, an older
  // device, or a lost context — since `new maplibregl.Map` throws synchronously
  // in that case (Leaflet's raster map had no WebGL dependency).
  if (typeof maplibregl === 'undefined') return stub
  const cfg = getConfig()
  const calibrationOffset = (cfg && cfg.rssiCalibrationOffset) || 0
  // Plot offset = calibration + attenuator added back (display-only, per tick).
  let attenuatorDb = 0
  let timeWindowMs = null
  const currentOffset = () => effectivePlotOffset(calibrationOffset, attenuatorDb)
  const styleFor = () => STYLES[cssVar('--ch-basemap') || 'dark'] || STYLES.dark

  let map
  try {
    map = new maplibregl.Map({
      container: containerId, style: styleFor(), center: [4, 51], zoom: 14,
      // pitchWithRotate governs the MOUSE path only (ctrl/right-drag); touch
      // pitch is a separate handler that already defaults on. Left false, a
      // desktop browser has no tilt gesture at all, so raising maxPitch alone
      // changed nothing there even though a phone could already tilt. Setting
      // it true reverses docs/2026-07-11-3d-mode.md's "not a free-tilt 3D
      // explorer" for mouse input only -- see docs/2026-08-17-free-tilt.md.
      attributionControl: false, dragRotate: true, pitchWithRotate: true, maxPitch: MAX_PITCH,
    })
  } catch (e) { return stub }
  map.addControl(new maplibregl.AttributionControl({ compact: true }))

  let mode = 'both', lastRecords = [], lastSelected = null
  let highlightId = null, onMarkerFocusCb = null, rotateCb = null, mode3D = false
  // Node-position layer (#197): registry nodes with a self-advertised position,
  // drawn against our own estimate. Off until the FAB turns it on.
  let nodePositions = [], nodeLayerOn = false, nodeMarkers = []
  // One probe per map for the label declutter (#539/#425): widths are
  // measured inside the map container, where .np-label's font actually
  // applies (a body probe reads the page's font and measures wrong).
  let npMeasure = null
  const labelMeasurer = () => npMeasure || (npMeasure = createLabelMeasurer(map.getContainer()))
  let nodePosSig = null   // signature guard: skip the rebuild when nothing changed, so a tapped popup survives the tick
  const ACQUIRE_ZOOM = 18
  let follow = true, lastPos = null, onFollow = null, acquired = false
  let trail = [], settingBearing = false

  // Follow releases when the user drags; native bearing gesture reports back via
  // onGestureRotate (guarded so our own setBearing calls don't count as user input).
  // Any deliberate "look somewhere else" gesture releases follow, or the next
  // GPS fix jumpTo's the camera straight back (setPosition). Shared by the drag
  // handler and by focusReception (#309), which is the same intent by tap.
  function releaseFollow() { if (follow && lastPos) { follow = false; if (onFollow) onFollow(false) } }
  map.on('dragstart', releaseFollow)
  map.on('rotate', () => { if (rotateCb && !settingBearing) rotateCb(map.getBearing()) })
  // Hex resolution depends on zoom — rebuild once the zoom settles.
  map.on('zoomend', () => draw())

  // ---- feature builders (GeoJSON sources are updated via setData) ----
  function buildPointsFC(records, nowMs) {
    const feats = []
    for (const r of records) {
      if (r.lat == null || r.lon == null) continue
      const tier = rssiTier(r.rssi, currentOffset())
      const fade = ageFade(r.rx_at, nowMs, timeWindowMs)   // age-fade within the window (#149)
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { id: String(r.id), color: cssVar(tierColorVar(tier)), op: fade, fop: fillOpacity(tier) * fade } })
    }
    return fc(feats)
  }
  // 3D twin of buildPointsFC (#250): an octagon footprint per reception (#308
  // rounded this from a square to match the flat 2D circle it replaces),
  // extruded to the same tier height as hex-3d's bars (extrusionHeight), so
  // hotter/closer receptions stand taller — same colour/height language as the
  // hex bars, just narrower, so points still read distinctly from hex cells.
  // fill-extrusion-opacity is layer-wide (MapLibre has no data-driven opacity
  // for it, same limitation noted on hex-3d), but fill-extrusion-color IS
  // per-feature — so tier opacity and age-fade ride in the colour's alpha
  // instead of being dropped (#302).
  // collapsePillars first (#402): coincident octagons are coplanar side walls in
  // one depth pass, which z-fights. It also drops the unpositioned records this
  // loop used to skip itself, so there is no second guard here. The flat 2D
  // layer is deliberately left uncollapsed -- circles have no side walls, so it
  // has overplotting but not this defect.
  // The collapse is cached, the collection is not (#462): collapsePillars is
  // the single most expensive thing a tick does — 157 ms of a 193 ms tick at
  // the largest observed store — and it depends only on the records. What is
  // built from it carries ageFade, which is a function of the clock, so that
  // half has to run every tick or the fade freezes on screen.
  const collapseCache = lastValueCache()
  function buildPoints3DFC(records, nowMs) {
    const feats = []
    for (const r of collapseCache.get(recordsKey(records), () => collapsePillars(records))) {
      const tier = rssiTier(r.rssi, currentOffset())
      const fade = ageFade(r.rx_at, nowMs, timeWindowMs)
      const ring = octagonRing(r.lat, r.lon, pillarRadiusM(r.lat, map.getZoom(), POINT_PILLAR_RADIUS_M, POINT_PILLAR_MIN_RADIUS_PX))
      // Alpha rides in the colour, not in fill-extrusion-opacity, which is a
      // single layer-wide number (#302). Same tier opacity x age-fade the flat
      // layer applies, so "still transmitting" still reads differently from
      // "was here ten minutes ago" in 3D.
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { id: String(r.id),
          color: withAlpha(cssVar(tierColorVar(tier)), fillOpacity(tier) * fade),
          height: extrusionHeight(r.rssi, currentOffset()) } })
    }
    return fc(feats)
  }
  // Fully cacheable, unlike the point collections: nothing here reads the clock.
  // A cell's colour and height come from the best RSSI in it and the attenuator
  // offset, so the answer changes only when the records, the zoom resolution or
  // that offset do — all three are in the key (#462).
  const hexCache = lastValueCache()
  function buildHexFC(records) {
    const res = hexResForZoom(map.getZoom())   // finer cells the more you zoom in
    // An unsignable set must not be cached under the string "null|10|0", which
    // is a perfectly good cache key and exactly the wrong one — the null has to
    // survive into the lookup.
    const sig = recordsKey(records)
    // The theme is in the key too (#412): the colours are read from the
    // tokens at build time, so a theme switch on unchanged records must not
    // serve the other theme's cells and bars from the cache.
    return hexCache.get(sig === null ? null : `${sig}|${res}|${currentOffset()}|${cssVar('--ch-basemap')}`, () => buildHexFCUncached(records, res))
  }
  function buildHexFCUncached(records, res) {
    const cells = new Map()
    for (const r of records) {
      if (r.lat == null || r.lon == null) continue
      const id = hexCellAt(r.lat, r.lon, res)
      const cur = cells.get(id)
      if (!cur || (r.rssi ?? -999) > (cur.best ?? -999)) cells.set(id, { best: r.rssi })
    }
    const feats = []
    for (const [id, c] of cells) {
      const ring = hexBoundary(id); if (!ring) continue // [lat,lon] closed ring → [lon,lat]
      const tier = rssiTier(c.best, currentOffset())
      const token = cssVar(tierColorVar(tier))
      // height and pillar are only read by the 3D fill-extrusion twin (hex-3d);
      // the flat 'hex' layer ignores them. Same source for both, per the
      // decision log. pillar is the cell's tint pre-mixed over the theme
      // background (#412): opaque, so the bar reads as its cell does.
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring.map(([la, lo]) => [lo, la])] },
        properties: { color: token, op: fillOpacity(tier), pillar: pillarTint(tier, token, cssVar('--ch-bg')), height: extrusionHeight(c.best, currentOffset()) } })
    }
    return fc(feats)
  }
  function buildHighlightFC() {
    if (highlightId == null) return EMPTY
    const r = lastRecords.find((x) => String(x.id) === String(highlightId))
    if (!r || r.lat == null || r.lon == null) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: {} }])
  }
  function buildHereFC() {
    if (!lastPos) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [lastPos[1], lastPos[0]] }, properties: {} }])
  }
  function buildTrailFC() {
    if (trail.length < 2) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: trail.map(([la, lo]) => [lo, la]) }, properties: {} }])
  }
  // ---- overlays: added on every style load (initial + theme switch) ----
  // overlaysReady flips true once the signal layers are mounted; the fallback
  // timer (armStyleFallback) uses it so a stuck basemap style can't leave the
  // map blank — the overlays must not be gated on a third-party basemap.
  let overlaysReady = false, styleTimer = null
  function armStyleFallback() {
    clearTimeout(styleTimer)
    styleTimer = setTimeout(() => {
      // Hosted style never mounted the overlays (offline / host down / cold PWA
      // cache) → drop to a bare background style and mount them there, so the
      // signal points/hex/trail/here survive basemap loss (a Leaflet raster 404
      // used to leave every overlay intact).
      if (!overlaysReady) { map.setStyle(bareStyle(cssVar('--ch-bg'))); mountBare() }
    }, 12000)
  }
  // Sky (#397). setStyle DROPS the sky — measured against the bundled 4.7.1:
  // getSky() returns null after a style swap — so this cannot be a one-off at
  // construction. It is re-applied from addOverlays, which is the one hook that
  // runs on every style load: initial, theme switch (applyBasemap) and the bare
  // fallback. Guarded on the method existing so an older MapLibre degrades to
  // the previous no-sky behaviour rather than throwing during init.
  function applySky() {
    if (typeof map.setSky !== 'function') return
    // setSky THROWS while a style is still loading — measured: with
    // isStyleLoaded() false it dies on "Cannot read properties of undefined
    // (reading 'transition')". addOverlays only runs post-load, but the minute
    // timer below is independent and can fire mid-swap (applyBasemap →
    // setStyle → loading), so it needs the guard. Nothing is lost by skipping:
    // addOverlays re-applies the sky as soon as that style finishes.
    if (!map.isStyleLoaded()) return
    // || 'dark' matches styleFor()'s rule for the same token: empty means the
    // stylesheet has not applied, and the app's default is the dark basemap.
    // sky.js caps only on the exact string 'dark', so this is what decides
    // that a missing token gets the capped palette rather than the light one.
    map.setSky(skyForHour(currentHour(), cssVar('--ch-basemap') || 'dark'))
  }
  // The clock moves during a hunt — a session that starts at dusk would keep a
  // dusk sky at midnight. Once a minute is far finer than the palette changes
  // (the tightest stop gap is 1.5 h) and costs one paint-property write.
  const skyTimer = setInterval(applySky, 60000)

  function addOverlays() {
    clearTimeout(styleTimer); overlaysReady = true
    applySky()
    // The style light shades every extrusion face; at MapLibre's default it
    // darkened a bar against its own cell (#412). Re-applied here like the
    // sky, since setStyle drops it. Guarded for an older MapLibre.
    if (typeof map.setLight === 'function') map.setLight({ anchor: 'viewport', intensity: EXTRUSION_LIGHT_INTENSITY })
    for (const id of ['trail', 'hex', 'points', 'points-3d', 'highlight', 'here', 'nodedrift', 'nodecircle']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
    }
    // One decision for all four signal layers (#266) — see maplayers.js. Both
    // this block and setView() read it, so a style reload and a FAB tap can no
    // longer disagree about what is on screen.
    const vis = layerVisibility({ mode, mode3D })
    const shown = (id) => (vis[id] ? 'visible' : 'none')
    if (!map.getLayer('trail')) map.addLayer({ id: 'trail', type: 'line', source: 'trail',
      paint: { 'line-color': cssVar('--ch-muted'), 'line-width': 3, 'line-opacity': 0.5 } })
    if (!map.getLayer('hex')) map.addLayer({ id: 'hex', type: 'fill', source: 'hex',
      layout: { visibility: shown('hex') },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } })
    // 3D twin of 'hex': same source, extruded to 'height' (RSSI/SNR tier, #147).
    // fill-extrusion-opacity is not data-driven, and one opacity for every
    // tier is what made a faint bar a solid purple on a 19% tint (#412). The
    // bar takes 'pillar', the cell's tint pre-mixed over the background, and
    // draws it opaque: no translucent compounding, shared walls depth-test.
    if (!map.getLayer('hex-3d')) map.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hex',
      layout: { visibility: shown('hex-3d') },
      paint: { 'fill-extrusion-color': ['get', 'pillar'], 'fill-extrusion-height': ['get', 'height'],
        // MapLibre shades extrusion sides darker toward their base by default
        // (#412). On a building that reads as depth; on these it reads as a
        // different tier, because colour is the signal the palette carries.
        'fill-extrusion-vertical-gradient': false,
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    // Buildings reuse the hosted style's own vector source (already fetched for
    // the 2D basemap) — only present on the hosted OpenFreeMap style, not the
    // bare fallback, hence the source guard.
    if (map.getSource('openmaptiles') && !map.getLayer('buildings-3d')) {
      // minzoom 13, not 14: OpenFreeMap's own TileJSON declares the `building`
      // vector layer at minzoom 13 (verified against tiles.openfreemap.org),
      // so 14 threw away a whole zoom level of geometry that was already in the
      // fetched tiles. 13 is the floor -- there is no building geometry below
      // it. Most visible at high pitch, where the far half of the view sits
      // below the current zoom (#395).
      map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        layout: { visibility: mode3D ? 'visible' : 'none' },
        // Keeps its vertical gradient, unlike the data layers (#412): a
        // building is a shape, so shading is what makes it read as one. The
        // data layers carry meaning in their colour, which is why they lose it.
        paint: { 'fill-extrusion-color': cssVar('--ch-building'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 } })
    }
    if (!map.getLayer('points')) map.addLayer({ id: 'points', type: 'circle', source: 'points',
      layout: { visibility: shown('points') },
      paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'fop'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-opacity': ['get', 'op'] } })
    // 3D twin of 'points' (#250): a fill-extrusion pillar per reception, same
    // tier colour/height as hex-3d — reads clearly at pitch instead of a flat
    // circle disappearing under the hex bars/buildings. Separate source (its
    // Polygon footprints can't double as the flat layer's Point geometry, the
    // way hex/hex-3d share one source), same constant-opacity limitation.
    if (!map.getLayer('points-3d')) map.addLayer({ id: 'points-3d', type: 'fill-extrusion', source: 'points-3d',
      layout: { visibility: shown('points-3d') },
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
        // Off for the same reason as hex-3d (#412): signal.js promises a bar's
        // height and colour always agree on the same tier, and a default-on
        // gradient darkens the sides until they do not.
        'fill-extrusion-vertical-gradient': false,
        // 1, not 0.9: the per-feature alpha in fill-extrusion-color carries
        // tier opacity and age-fade, and a layer-wide value would multiply on
        // top of it (#302).
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    if (!map.getLayer('highlight')) map.addLayer({ id: 'highlight', type: 'circle', source: 'highlight',
      paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--ch-accent'), 'circle-stroke-width': 3 } })
    if (!map.getLayer('here')) map.addLayer({ id: 'here', type: 'circle', source: 'here',
      paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--ch-accent'), 'circle-stroke-width': 2 } })
    // Node-position layer (#197), added last so it sits above the hex heat —
    // it is an explicit opt-in overlay, and a connector buried under a hot hex
    // cell defeats the point of drawing it. The connector is solid; the circle
    // is dashed for a trusted search radius and dotted for the drift fallback,
    // so the two read differently without needing a label.
    if (!map.getLayer('nodedrift')) map.addLayer({ id: 'nodedrift', type: 'line', source: 'nodedrift',
      layout: { visibility: nodeLayerOn ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 } })
    // Two layers over one source, split by dash pattern: line-dasharray is not
    // a data-driven property in MapLibre (a `case` expression there fails style
    // validation and the layer never mounts), so each pattern needs its own
    // layer with a constant value and a filter.
    if (!map.getLayer('nodecircle-search')) map.addLayer({ id: 'nodecircle-search', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'search'],
      layout: { visibility: nodeLayerOn ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [4, 4] } })
    if (!map.getLayer('nodecircle-drift')) map.addLayer({ id: 'nodecircle-drift', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'drift'],
      layout: { visibility: nodeLayerOn ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [1, 3] } })
    draw()
  }
  // Initial style: 'load' fires once when the first style is ready. A theme
  // switch (setStyle) does NOT re-fire 'load'/'style.load' — only 'styledata' —
  // so applyBasemap re-adds the overlays via afterStyle once the new style
  // finishes. addOverlays is idempotent (guards on existing source/layer).
  // afterStyle runs cb once a HOSTED (network) style finishes loading after
  // setStyle. 'idle' fires only after the new style + tiles settle, so it avoids
  // the race where isStyleLoaded() is briefly true for the OLD style.
  function afterStyle(cb) { map.once('idle', cb) }
  // mountBare adds the overlays onto the inline bare fallback style. An inline
  // style applies SYNCHRONOUSLY and emits no styledata/idle/style.load event
  // (and the map never reaches 'idle' when it got here stuck mid-load), so poll
  // isStyleLoaded() — which is immediately true — rather than waiting on a hook.
  function mountBare() { if (map.isStyleLoaded()) addOverlays(); else setTimeout(mountBare, 100) }
  map.on('load', addOverlays)
  armStyleFallback()   // safety net if the initial hosted style never loads

  // Point tap → open popup + roll the receptions-log playhead (#130). Registered
  // once; fires only while the 'points'/'points-3d' layer exists. Bound to
  // both layers (#250) — whichever one is visible for the current 2D/3D mode
  // is the one that can actually receive the click.
  function onPointClick(e) {
    const f = e.features && e.features[0]; if (!f) return
    const r = lastRecords.find((x) => String(x.id) === String(f.properties.id)); if (!r) return
    if (onMarkerFocusCb) onMarkerFocusCb(r)
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setLngLat([r.lon, r.lat]).setHTML(popupHtml(r, lastSelected)).addTo(map)
    wireIsolate(popup, r); wireIgnore(popup, r)
  }
  for (const layerId of ['points', 'points-3d']) {
    map.on('click', layerId, onPointClick)
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
  }

  // MapLibre latches onto its 400×300 zero-size fallback when the map is built
  // before #map has laid out — a backgrounded tab, a PWA cold start, or (here)
  // creation after `await loadConfig()` in DOMContentLoaded. Its own resize
  // tracking doesn't reliably clear that initial latch, so the map renders in a
  // corner (or blank), and any later camera move — notably the 3D toggle's
  // pitch easeTo — just repaints at the wrong size. Reconcile the canvas to
  // its container whenever they disagree; cheap enough to run each render tick.
  function syncSize() {
    const c = map.getContainer(), cv = map.getCanvas()
    if (c.clientWidth && c.clientHeight &&
        (Math.abs(cv.clientWidth - c.clientWidth) > 1 || Math.abs(cv.clientHeight - c.clientHeight) > 1)) {
      map.resize()
    }
  }

  function draw() {
    syncSize()
    if (!map.getSource('points')) return   // style not ready yet
    const records = lastRecords, nowMs = Date.now()
    // Build only what a visible layer will read (#266). Previously all three
    // were rebuilt and re-uploaded every 1 Hz tick regardless of mode, so one
    // of the two point collections was always tessellated and shipped to the
    // GPU for a layer set to visibility:none. hex and hex-3d share one source,
    // so it is built when either is on.
    const vis = layerVisibility({ mode, mode3D })
    map.getSource('hex').setData(vis.hex || vis['hex-3d'] ? buildHexFC(records) : EMPTY)
    map.getSource('points').setData(vis.points ? buildPointsFC(records, nowMs) : EMPTY)
    map.getSource('points-3d').setData(vis['points-3d'] ? buildPoints3DFC(records, nowMs) : EMPTY)
    map.getSource('trail').setData(buildTrailFC())
    map.getSource('highlight').setData(buildHighlightFC())
    map.getSource('here').setData(buildHereFC())
    drawNodeLayer(records)
  }

  // ---- node-position layer (#197) ----
  // Colour encodes only what the rules decide, never a judgement about which
  // position is "right": the advertised one is operator-self-reported and can
  // be stale, so a gap is drift, not error.
  function driftColor(p) {
    if (p.kind === 'tight') return cssVar('--ch-accent')
    if (p.kind === 'drifted' && p.outsideCircle) return cssVar('--ch-accent-2')
    return cssVar('--ch-muted')
  }

  // The name rides alongside the ▲ rather than only inside the popup: this
  // layer is opt-in, so the map can afford the labels while it is on. The
  // label is absolutely positioned so it never shifts the glyph off the
  // coordinate the marker is anchored to.
  function nodeMarkerEl(cls, glyph, label) {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const el = document.createElement('div')
    const name = label ? `<span class="np-label">${esc(label)}</span>` : ''
    el.innerHTML = `<div class="${cls}">${glyph}${name}</div>`
    return el
  }

  // A Marker built from a custom element does not toggle its popup on tap by
  // itself, so wire the click explicitly.
  function addNodeMarker(cls, glyph, lngLat, popup, label) {
    const el = nodeMarkerEl(cls, glyph, label)
    const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).setPopup(popup).addTo(map)
    el.addEventListener('click', (e) => { e.stopPropagation(); marker.togglePopup() })
    nodeMarkers.push(marker)
  }

  // Recomputed per tick: the visible node set follows the viewport, and each
  // node's estimate follows whatever receptions are currently plotted.
  // Signature guards (like web/map.js) prevent popup flicker on every 1Hz render.
  function drawNodeLayer(records) {
    if (!map.getSource('nodedrift')) return
    if (!nodeLayerOn) {
      map.getSource('nodedrift').setData(EMPTY)
      map.getSource('nodecircle').setData(EMPTY)
      nodeMarkers.forEach((m) => m.remove()); nodeMarkers = []
      return
    }

    const b = map.getBounds()
    const bounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }
    const draw = []

    // Registry nodes in view: advertised position, plus our estimate when we
    // have heard them enough to produce one. Match sender_id (from receptions)
    // against node pubkey: exact match for advert_pubkey, prefix match for
    // discover_pubkey, no match for relay/direct_hash/channel_name (#197/#272).
    // One pass over the records for the whole in-view set, not one pass per
    // node: this also lets an id that matches two nodes be refused outright
    // rather than attributed to both (#295).
    const inView = nodesInView(nodePositions, bounds)
    const byNode = groupSenderPointsForNodes(records, inView)
    for (const n of inView) {
      const pts = byNode.get(String(n.pubkey).toLowerCase()) || []
      const est = pts.length ? estimateFor(pts) : null
      const p = driftPresentation({ advertised: n, estimate: est })
      if (p.kind === 'none') continue
      draw.push({ n, est, p })
    }

    // Screen-space label declutter (#539, the map's #425 taken verbatim):
    // walk the nodes in a stable id order and keep a name only where its
    // measured box is clear of the ones already kept. The ▲ always stays and
    // the name is still in the popup. Recomputed per draw, so zooming in
    // separates the projected points and names come forward on their own —
    // and at a steep 3D pitch map.project answers through the tilted camera,
    // so the boxes are where the labels actually paint.
    const labelled = new Set(unclutteredLabels(
      [...draw]
        .sort((a, b) => (a.n.pubkey < b.n.pubkey ? -1 : a.n.pubkey > b.n.pubkey ? 1 : 0))
        .map((d) => {
          const pt = map.project([d.n.lon, d.n.lat])
          return { id: d.n.pubkey, x: pt.x, y: pt.y, label: d.n.name || d.n.pubkey }
        }),
      { measure: labelMeasurer() },
    ))

    // Compute signature of what would be drawn — if unchanged, skip rebuild to preserve open popups
    const sig = draw.map((d) => [d.n.pubkey, d.n.lat, d.n.lon, d.p.kind, Math.round(d.p.driftM ?? -1),
      Math.round(d.p.circle ? d.p.circle.radiusM : -1),
      d.est ? `${d.est.centroid.lat.toFixed(5)},${d.est.centroid.lon.toFixed(5)}` : ''].join(':')).join('|')
      // The label set depends on the projection, not the rows: a zoom that
      // changes no node still changes which names fit (#539). Without it in
      // the signature the early return would freeze the previous zoom's set.
      + '#' + [...labelled].join(',')
    if (sig === nodePosSig) return   // nothing changed — leave the layer (and any open popup) alone
    nodePosSig = sig

    const lines = [], circles = []
    nodeMarkers.forEach((m) => m.remove()); nodeMarkers = []

    for (const { n, est, p } of draw) {
      const color = driftColor(p)
      // Only the ▲ is labelled — the ● belongs to the same node, so naming
      // both would just double the text for one target — and only where the
      // declutter kept the name (#539).
      addNodeMarker('np-advert', '▲', [n.lon, n.lat], nodePopup(n, p, est), labelled.has(n.pubkey) ? (n.name || n.pubkey) : null)
      if (!est || !est.centroid) continue
      addNodeMarker('np-estimate', '', [est.centroid.lon, est.centroid.lat], nodePopup(n, p, est))
      lines.push({ type: 'Feature', properties: { color },
        geometry: { type: 'LineString', coordinates: [[n.lon, n.lat], [est.centroid.lon, est.centroid.lat]] } })
      if (p.circle) {
        const ring = circleRing(est.centroid, p.circle.radiusM)
        if (ring.length) circles.push({ type: 'Feature', properties: { color, style: p.circle.kind },
          geometry: { type: 'LineString', coordinates: ring } })
      }
    }
    map.getSource('nodedrift').setData(fc(lines))
    map.getSource('nodecircle').setData(fc(circles))
  }

  function nodePopup(n, p, est) {
    const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const markers = p.kind === 'advertised-only' ? '▲ advertised' : '▲ advertised · ● estimated'
    // "no estimate" is not the same as "not heard" (#272). An advert or a
    // discover reply names the node outright, so those receptions join to it
    // and produce an estimate. A relayed packet measures the LAST HOP that
    // re-broadcast to us — a valid measurement of that repeater, but carried on
    // a 2-byte path prefix, which cannot be pinned to one registry node. So a
    // node heard only that way has plenty of receptions and still no estimate
    // here, and claiming it was never heard would be wrong.
    const drift = p.driftM != null
      ? `<br>drift ${Math.round(p.driftM)} m · ${est ? est.n : 0} points`
      : '<br>no estimate — no reception identifies this node directly'
    // The circle only claims accuracy when the sampling geometry earned it;
    // say which of the two is being drawn so the map is self-explaining.
    const circle = p.circle
      ? `<br><span class="np-muted">${p.circle.kind === 'search'
          ? `search radius ~${Math.round(p.circle.radiusM)} m`
          : 'one-sided — radius not trusted'}</span>`
      : ''
    return new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setHTML(`<div class="ch-popup">${esc(n.name || n.pubkey)}<br>`
        + `<span class="np-muted">${markers}</span>${drift}${circle}`
        + `<br><span class="np-muted np-caveat">Advertised position is self-reported by the operator and may be stale.</span></div>`)
  }

  // ---- public API (unchanged from the Leaflet version) ----
  function render(records, selectedIds) { lastRecords = records || []; lastSelected = selectedIds || null; draw() }
  function setHighlight(id) { highlightId = id == null ? null : id; if (map.getSource('highlight')) map.getSource('highlight').setData(buildHighlightFC()) }
  function onMarkerFocus(cb) { onMarkerFocusCb = cb }
  function setPosition(lat, lon) {
    lastPos = [lat, lon]
    const next = appendTrailPoint(trail, lat, lon)
    if (next !== trail) { trail = next; if (map.getSource('trail')) map.getSource('trail').setData(buildTrailFC()) }
    if (map.getSource('here')) map.getSource('here').setData(buildHereFC())
    // jumpTo is an instant, non-animated camera set — calling it while the
    // user has an active gesture (e.g. pinch-zoom) in progress interrupts
    // MapLibre's own interaction handler and cancels the gesture (#236: this
    // is why pinch-to-zoom didn't work while compass mode was following). A
    // GPS fix landing mid-pinch now just skips this recenter; the next fix
    // (or the user releasing the gesture) catches up.
    if (follow && !map.isZooming() && !map.isMoving()) {
      map.jumpTo({ center: [lon, lat], zoom: acquired ? map.getZoom() : ACQUIRE_ZOOM })
      acquired = true
    }
  }
  function centerOn(lat, lon) { map.easeTo({ center: [lon, lat], duration: 400 }) }
  function recenter() { if (!lastPos) return; follow = true; map.jumpTo({ center: [lastPos[1], lastPos[0]] }); if (onFollow) onFollow(true) }
  function onFollowChange(cb) { onFollow = cb }
  function setBearing(deg) { settingBearing = true; try { map.setBearing(deg) } finally { settingBearing = false } }
  function onGestureRotate(cb) { rotateCb = cb }
  // Applies the current layer decision to the live style. Both the layer-mode
  // switch and the 3D toggle need it: in 3D the mode decides whether hex is
  // drawn flat (under the pillars) or extruded (#266).
  function applyLayerVisibility() {
    const vis = layerVisibility({ mode, mode3D })
    for (const id of ['hex', 'hex-3d', 'points', 'points-3d']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis[id] ? 'visible' : 'none')
    }
  }
  // setView(m, v) — the view FAB's one entry point (#336). The layer mode and
  // the 2D/3D flag used to be set through two methods, each doing its own
  // applyLayerVisibility() + draw(), so a single tap ran two full
  // tessellate-and-upload passes over the whole record set. Nothing painted in
  // between (both were synchronous within one task), so it was invisible — but
  // it doubled the work on the one control designed to be used one-handed
  // while driving. Assign both, then apply once.
  // Pitch: only a tap that crosses the 2D/3D line moves the camera
  // (pitchTransition, maplayers.js). Easing on every tap threw away any angle
  // the tilt gesture had set, which is three of the five steps in the cycle.
  function setView(m, v) {
    const was3D = mode3D
    mode = m
    mode3D = !!v
    applyLayerVisibility()
    const pitch = pitchTransition(was3D, mode3D)
    if (pitch !== null) map.easeTo({ pitch, duration: 500 })
    // draw() is needed even when only the flag changed: the hidden collection's
    // source is left at EMPTY (that is the point of the per-tick build guard),
    // so revealing it without repopulating shows nothing until the next 1 Hz tick.
    draw()
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', mode3D ? 'visible' : 'none')
  }
  // Node-position layer (#197): the registry set is fetched once by app.js and
  // handed over whole; bounds filtering happens here per tick.
  function setNodePositions(nodes) { nodePositions = Array.isArray(nodes) ? nodes : []; draw() }
  function setNodeLayerVisible(v) {
    nodeLayerOn = !!v
    for (const id of ['nodedrift', 'nodecircle-search', 'nodecircle-drift']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', nodeLayerOn ? 'visible' : 'none')
    }
    draw()
  }
  function setAttenuator(db) { attenuatorDb = Number(db) || 0; draw() }
  function setTimeWindow(ms) { timeWindowMs = ms == null ? null : Number(ms) || null }
  function applyBasemap() { overlaysReady = false; map.setStyle(styleFor()); afterStyle(addOverlays); armStyleFallback() }   // re-add overlays after the style swap (+ fallback if it fails)
  // Pan to a reception, no popup: the ticker row that triggers this (#309) sits
  // over the map on a phone, and a popup on top of it would cover the very list
  // the user is scrubbing. The highlight ring (setHighlight, driven by the
  // ticker's own onActiveChange) is what marks the record; this only moves the
  // camera there. A record with no fix is silently ignored — its point is not
  // on the map to pan to.
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    releaseFollow()
    centerOn(rec.lat, rec.lon)
  }
  function destroy() { clearInterval(skyTimer); clearTimeout(styleTimer); map.remove() }
  return { setPosition, centerOn, recenter, onFollowChange, render, setView, applyBasemap, focusReception, setAttenuator, setTimeWindow, setBearing, onGestureRotate, setHighlight, onMarkerFocus, setNodePositions, setNodeLayerVisible, destroy }
}

function popupHtml(r, selectedIds) {
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  // Glossary (#174): 'sender' is the general term for a heard device, 'repeater'
  // for one known to be relaying (not originating) traffic. `relay` here is the
  // internal sender_kind value (meshpacket.js) -- only its display label changed.
  const kindLabel = { channel_name: 'name', advert_pubkey: 'sender', discover_pubkey: 'sender', relay: 'repeater' }[r.sender_kind] || 'sender'
  const senderLine = r.sender_id ? `${kindLabel} ${esc(r.sender_label || r.sender_id)}` : 'sender — (none)'
  const chanLine = r.channel_name ? `<br>channel ${esc(r.channel_name)}` : ''
  const textLine = r._text ? `<br>"${esc(r._text)}"` : ''
  const key = r.sender_id ? String(r.sender_id).toLowerCase() : null
  const sole = !!(key && selectedIds && selectedIds.size === 1 && selectedIds.has(key))
  const isolateBtn = sole
    ? `<button class="ch-isolate active" disabled>Isolated ✓</button>`
    : `<button class="ch-isolate" ${r.sender_id ? '' : 'disabled'}>Isolate sender</button>`
  return `<div class="ch-popup">RSSI ${esc(r.rssi)} · SNR ${esc(r.snr)}<br>`
    + `${esc(packetTypeLabel(r.packet_type))}<br>`
    + senderLine + chanLine + textLine + '<br>'
    + isolateBtn
    + ` <button class="ch-ignore" ${r.sender_id ? '' : 'disabled'}>Ignore this ID</button></div>`
}
function wireIsolate(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-isolate')
  if (!btn || !r.sender_id || btn.disabled) return
  btn.onclick = () => {
    document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id: r.sender_id, label: r.sender_label } }))
    btn.textContent = 'Isolated ✓'; btn.disabled = true; btn.classList.add('active')
  }
}
function wireIgnore(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-ignore')
  if (btn && r.sender_id) btn.onclick = () => document.dispatchEvent(new CustomEvent('hunt:ignore-sender', { detail: { id: r.sender_id } }))
}
