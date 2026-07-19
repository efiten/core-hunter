import { hexCellAt, hexBoundary, hexResForZoom } from './hexgrid.js'
import { rssiTier, tierColorVar, fillOpacity, effectivePlotOffset, ageFade, heatWeight, extrusionHeight } from './signal.js'
import { getConfig } from './config.js'
import { locate, toLocatePoints } from './locate.js'
import { nodesInView, driftPresentation, groupSenderPoints, estimateFor, circleRing } from './nodelayer.js'
import { appendTrailPoint } from './trail.js'
import { packetTypeLabel } from './filters.js'

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

// 3D mode (#147 phase 2): the FAB just tilts the camera and swaps the flat hex
// layer for its fill-extrusion twin — same 'hex' source, height added per
// feature (extrusionHeight). Buildings reuse the OpenFreeMap style's own
// "openmaptiles"/"building" source, already fetched for the 2D basemap, so 3D
// adds no new data request. (Terrain was dropped — see docs/2026-07-11-3d-mode.md:
// its AWS DEM tiles kept the map in a perpetual load loop and froze weaker GPUs.)
const PITCH_3D = 60

export function createHuntMap(containerId) {
  const stub = { setPosition() {}, centerOn() {}, recenter() {}, onFollowChange() {}, onLocate() {}, setLocateVisible() {}, render() {}, setLayerMode() {}, set3D() {}, applyBasemap() {}, focusReception() {}, setAttenuator() {}, setTimeWindow() {}, setBearing() {}, onGestureRotate() {}, setHighlight() {}, onMarkerFocus() {}, setNodePositions() {}, setNodeLayerVisible() {}, destroy() {} }
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
      attributionControl: false, dragRotate: true, pitchWithRotate: false,
    })
  } catch (e) { return stub }
  map.addControl(new maplibregl.AttributionControl({ compact: true }))

  let mode = 'both', lastRecords = [], lastSelected = null, onLocateCb = null, locateVisible = true
  let highlightId = null, onMarkerFocusCb = null, rotateCb = null, mode3D = false
  // Node-position layer (#197): registry nodes with a self-advertised position,
  // drawn against our own estimate. Off until the FAB turns it on.
  let nodePositions = [], nodeLayerOn = false, nodeMarkers = []
  const ACQUIRE_ZOOM = 18
  let follow = true, lastPos = null, onFollow = null, acquired = false
  let trail = [], settingBearing = false, locateMarkers = []

  // Follow releases when the user drags; native bearing gesture reports back via
  // onGestureRotate (guarded so our own setBearing calls don't count as user input).
  map.on('dragstart', () => { if (follow && lastPos) { follow = false; if (onFollow) onFollow(false) } })
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
  function buildHexFC(records) {
    const cells = new Map()
    const res = hexResForZoom(map.getZoom())   // finer cells the more you zoom in
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
      // height is only read by the 3D fill-extrusion twin (hex-3d); the flat
      // 'hex' layer ignores it. Same source for both, per the decision log.
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring.map(([la, lo]) => [lo, la])] },
        properties: { color: cssVar(tierColorVar(tier)), op: fillOpacity(tier), height: extrusionHeight(c.best, currentOffset()) } })
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
  function buildLocateHeatFC(records) {
    return fc(toLocatePoints(records).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { w: heatWeight(p.rssi) } })))
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
  function addOverlays() {
    clearTimeout(styleTimer); overlaysReady = true
    for (const id of ['trail', 'hex', 'locate', 'points', 'highlight', 'here', 'nodedrift', 'nodecircle']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
    }
    if (!map.getLayer('trail')) map.addLayer({ id: 'trail', type: 'line', source: 'trail',
      paint: { 'line-color': cssVar('--ch-muted'), 'line-width': 3, 'line-opacity': 0.5 } })
    if (!map.getLayer('hex')) map.addLayer({ id: 'hex', type: 'fill', source: 'hex',
      layout: { visibility: mode3D ? 'none' : 'visible' },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } })
    // 3D twin of 'hex': same source, extruded to 'height' (RSSI/SNR tier, #147).
    // fill-extrusion-opacity doesn't support data-driven expressions (unlike
    // fill-opacity on the flat layer), so it's a flat constant here — the tier
    // is still visible via colour + height.
    if (!map.getLayer('hex-3d')) map.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hex',
      layout: { visibility: mode3D ? 'visible' : 'none' },
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.85 } })
    // Buildings reuse the hosted style's own vector source (already fetched for
    // the 2D basemap) — only present on the hosted OpenFreeMap style, not the
    // bare fallback, hence the source guard.
    if (map.getSource('openmaptiles') && !map.getLayer('buildings-3d')) {
      map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        layout: { visibility: mode3D ? 'visible' : 'none' },
        paint: { 'fill-extrusion-color': cssVar('--ch-building'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 } })
    }
    if (!map.getLayer('locate-heat')) map.addLayer({ id: 'locate-heat', type: 'heatmap', source: 'locate',
      layout: { visibility: locateVisible ? 'visible' : 'none' },
      paint: { 'heatmap-weight': ['get', 'w'], 'heatmap-intensity': 1, 'heatmap-radius': 32, 'heatmap-opacity': 0.7,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, cssVar('--ch-sig-mid'), 0.6, cssVar('--ch-sig-warm'), 1, cssVar('--ch-sig-hot')] } })
    if (!map.getLayer('points')) map.addLayer({ id: 'points', type: 'circle', source: 'points',
      paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'fop'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-opacity': ['get', 'op'] } })
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
  // once; fires only while the 'points' layer exists.
  function onPointClick(e) {
    const f = e.features && e.features[0]; if (!f) return
    const r = lastRecords.find((x) => String(x.id) === String(f.properties.id)); if (!r) return
    if (onMarkerFocusCb) onMarkerFocusCb(r)
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setLngLat([r.lon, r.lat]).setHTML(popupHtml(r, lastSelected)).addTo(map)
    wireIsolate(popup, r); wireIgnore(popup, r)
  }
  map.on('click', 'points', onPointClick)
  map.on('mouseenter', 'points', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'points', () => { map.getCanvas().style.cursor = '' })

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
    map.getSource('hex').setData(mode !== 'points' ? buildHexFC(records) : EMPTY)
    map.getSource('points').setData(mode !== 'hex' ? buildPointsFC(records, nowMs) : EMPTY)
    map.getSource('trail').setData(buildTrailFC())
    map.getSource('highlight').setData(buildHighlightFC())
    map.getSource('here').setData(buildHereFC())
    drawLocate(records)
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

  function nodeMarkerEl(cls, glyph) {
    const el = document.createElement('div')
    el.innerHTML = `<div class="${cls}">${glyph}</div>`
    return el
  }

  // A Marker built from a custom element does not toggle its popup on tap by
  // itself, so wire the click explicitly.
  function addNodeMarker(cls, glyph, lngLat, popup) {
    const el = nodeMarkerEl(cls, glyph)
    const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).setPopup(popup).addTo(map)
    el.addEventListener('click', (e) => { e.stopPropagation(); marker.togglePopup() })
    nodeMarkers.push(marker)
  }

  // Recomputed per tick: the visible node set follows the viewport, and each
  // node's estimate follows whatever receptions are currently plotted.
  function drawNodeLayer(records) {
    nodeMarkers.forEach((m) => m.remove()); nodeMarkers = []
    if (!map.getSource('nodedrift')) return
    if (!nodeLayerOn) {
      map.getSource('nodedrift').setData(EMPTY)
      map.getSource('nodecircle').setData(EMPTY)
      return
    }
    const b = map.getBounds()
    const bounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }
    const bySender = groupSenderPoints(records)
    const lines = [], circles = []

    // Registry nodes in view: advertised position, plus our estimate when we
    // have heard them enough to produce one.
    for (const n of nodesInView(nodePositions, bounds)) {
      const key = String(n.pubkey || '').toLowerCase()
      const est = bySender.has(key) ? estimateFor(bySender.get(key)) : null
      const p = driftPresentation({ advertised: n, estimate: est })
      if (p.kind === 'none') continue
      const color = driftColor(p)
      addNodeMarker('np-advert', '▲', [n.lon, n.lat], nodePopup(n, p, est))
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
    const drift = p.driftM != null
      ? `<br>drift ${Math.round(p.driftM)} m · ${est ? est.n : 0} points`
      : '<br>not heard yet — no estimate'
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

  // Locate: RSSI-weighted centroid + density heatmap over the plotted set (same
  // pure algorithm as web/map.js — see locate.js). The estimate always computes
  // so the readout is instant; visibility only hides the rendered overlay.
  function drawLocate(records) {
    const points = toLocatePoints(records)
    const res = points.length ? locate(points) : null
    if (map.getSource('locate')) map.getSource('locate').setData(locateVisible && res ? buildLocateHeatFC(records) : EMPTY)
    locateMarkers.forEach((m) => m.remove()); locateMarkers = []
    if (!locateVisible || !res) { if (onLocateCb) onLocateCb(null); return }
    if (res.centroid) {
      const el = document.createElement('div'); el.innerHTML = '<div class="lc-centroid"></div>'
      locateMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([res.centroid.lon, res.centroid.lat]).addTo(map))
    }
    if (res.strongest) {
      const el = document.createElement('div'); el.innerHTML = '<div class="lc-strongest">★</div>'
      locateMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([res.strongest.lon, res.strongest.lat]).addTo(map))
    }
    if (onLocateCb) onLocateCb(res)
  }

  // ---- public API (unchanged from the Leaflet version) ----
  function render(records, selectedIds) { lastRecords = records || []; lastSelected = selectedIds || null; draw() }
  function onLocate(cb) { onLocateCb = cb }
  function setLocateVisible(v) {
    locateVisible = !!v
    if (map.getLayer('locate-heat')) map.setLayoutProperty('locate-heat', 'visibility', locateVisible ? 'visible' : 'none')
    draw()
  }
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
  function setLayerMode(m) { mode = m; draw() }
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
  // set3D(v) — the 2D/3D FAB: tilts the camera, swaps the flat hex layer for its
  // extruded twin, and shows 3D buildings (#147 phase 2).
  function set3D(v) {
    mode3D = !!v
    map.easeTo({ pitch: mode3D ? PITCH_3D : 0, duration: 500 })
    if (map.getLayer('hex')) map.setLayoutProperty('hex', 'visibility', mode3D ? 'none' : 'visible')
    if (map.getLayer('hex-3d')) map.setLayoutProperty('hex-3d', 'visibility', mode3D ? 'visible' : 'none')
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', mode3D ? 'visible' : 'none')
  }
  function setAttenuator(db) { attenuatorDb = Number(db) || 0; draw() }
  function setTimeWindow(ms) { timeWindowMs = ms == null ? null : Number(ms) || null }
  function applyBasemap() { overlaysReady = false; map.setStyle(styleFor()); afterStyle(addOverlays); armStyleFallback() }   // re-add overlays after the style swap (+ fallback if it fails)
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    centerOn(rec.lat, rec.lon)
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat([rec.lon, rec.lat]).setHTML(popupHtml(rec, lastSelected)).addTo(map)
    wireIsolate(popup, rec); wireIgnore(popup, rec)
  }
  function destroy() { map.remove() }
  return { setPosition, centerOn, recenter, onFollowChange, onLocate, setLocateVisible, render, setLayerMode, set3D, applyBasemap, focusReception, setAttenuator, setTimeWindow, setBearing, onGestureRotate, setHighlight, onMarkerFocus, setNodePositions, setNodeLayerVisible, destroy }
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
