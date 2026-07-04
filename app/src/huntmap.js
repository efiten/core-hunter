import { hexCellAt, hexBoundary, hexResForZoom } from './hexgrid.js'
import { rssiTier, tierColorVar, fillOpacity, effectivePlotOffset, ageFade } from './signal.js'
import { getConfig } from './config.js'
import { locate, toLocatePoints } from './locate.js'

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// Density-cloud ramp from the --ch-sig-* tokens (warm -> hot only), mirrors
// web/map.js's heatStops/heatColor so the single-hunter locate overlay looks
// the same as the multi-hunter one.
function heatStops() {
  const hex = (h) => { const s = h.replace('#', '').trim(); const n = s.length === 3 ? s.split('').map((x) => x + x).join('') : s; return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)] }
  return ['--ch-sig-mid', '--ch-sig-warm', '--ch-sig-hot'].map((nm) => hex(cssVar(nm)))
}
function heatColor(v, stops) {
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  const a = stops[i], b = stops[i + 1]
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f))
}
// Paint a normalized density grid to a canvas and return a Leaflet image overlay.
function heatmapOverlay(hm) {
  const { grid, rows, cols, bounds } = hm
  const canvas = document.createElement('canvas')
  canvas.width = cols; canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  const stops = heatStops()
  const FLOOR = 0.12
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c]
      const y = rows - 1 - r
      const idx = (y * cols + c) * 4
      const [cr, cg, cb] = heatColor(v, stops)
      img.data[idx] = cr; img.data[idx + 1] = cg; img.data[idx + 2] = cb
      img.data[idx + 3] = v < FLOOR ? 0 : Math.round(210 * (v - FLOOR) / (1 - FLOOR))
    }
  }
  ctx.putImageData(img, 0, 0)
  return L.imageOverlay(canvas.toDataURL(), [[bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]],
    { opacity: 0.7, interactive: false })
}

// leaflet-rotate (0.2.8, latest) overrides L.Renderer._updateTransform and its
// own source carries an unresolved "@FIXME: layer drifts on map.setZoom() (eg.
// zoom during animation)": with `rotate: true` the vector/marker panes are
// re-transformed on every zoom-animation/pinch frame against a corrupted
// anchor, so points and hexes drift visibly off the basemap until the fingers
// release (#167). Tiles stay correct because GridLayer keeps its own per-level
// origin and transforms with `origin × scale − map._getNewPixelOrigin()` — so
// give the renderer the exact same math. Two things matter:
//  1. the container content is drawn relative to _bounds.min under the pixel
//     origin that was current when _update() computed those bounds — and the
//     map's stored pixel origin has ALREADY moved to the destination zoom by
//     the time _updateTransform fires, so that origin must be snapshotted in
//     _update() (the plugin instead re-derives the anchor via its
//     rotation-aware layerPointToLatLng, which bakes stale rotate-pane
//     offsets into it — that is the drift);
//  2. the target frame is the plugin's rotation-aware _getNewPixelOrigin,
//     the same one the tiles use, so vectors and tiles cannot diverge.
// Remove when fixed upstream.
function patchRendererZoomTransform() {
  if (typeof L === 'undefined' || !L.Renderer || L.Renderer.prototype._chZoomDriftPatched) return
  const prevUpdate = L.Renderer.prototype._update
  const prevTransform = L.Renderer.prototype._updateTransform
  L.Renderer.prototype._update = function () {
    const r = prevUpdate.apply(this, arguments)
    if (this._map && this._map._rotate) this._chPixelOrigin = this._map.getPixelOrigin()
    return r
  }
  L.Renderer.prototype._updateTransform = function (center, zoom) {
    if (!this._map._rotate) return prevTransform.apply(this, arguments)
    const scale = this._map.getZoomScale(zoom, this._zoom)
    const offset = this._bounds.min.add(this._chPixelOrigin || this._map.getPixelOrigin())
      .multiplyBy(scale)
      .subtract(this._map._getNewPixelOrigin(center, zoom))
    L.DomUtil.setTransform(this._container, offset, scale)
  }
  L.Renderer.prototype._chZoomDriftPatched = true
}

export function createHuntMap(containerId) {
  if (typeof L === 'undefined') return { setPosition() {}, centerOn() {}, recenter() {}, onFollowChange() {}, onLocate() {}, setLocateVisible() {}, render() {}, setLayerMode() {}, applyBasemap() {}, focusReception() {}, setAttenuator() {}, setTimeWindow() {}, setBearing() {}, onGestureRotate() {}, setHighlight() {}, onMarkerFocus() {}, destroy() {} }
  patchRendererZoomTransform()
  const cfg = getConfig()
  const calibrationOffset = (cfg && cfg.rssiCalibrationOffset) || 0
  // Plot offset = calibration + attenuator added back. Attenuator is set at
  // runtime (settings), so the offset is computed per render, not captured once.
  let attenuatorDb = 0
  let timeWindowMs = null
  const currentOffset = () => effectivePlotOffset(calibrationOffset, attenuatorDb)
  // rotate/touchRotate come from the leaflet-rotate plugin (#116): real map
  // rotation on device heading plus a two-finger rotate gesture. Without the
  // plugin (CDN failure) the options are inert and the map stays north-up.
  const map = L.map(containerId, { zoomControl: false, rotate: true, touchRotate: true, rotateControl: false }).setView([51, 4], 14)
  const TILES = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  }
  let base = null
  function applyBasemap() {
    const which = cssVar('--ch-basemap') || 'dark'
    if (base) map.removeLayer(base)
    // CARTO's raster basemaps serve native tiles up to z20; maxZoom was capped
    // at 19, one level short of what the tiles actually support.
    base = L.tileLayer(TILES[which] || TILES.dark, { maxZoom: 20 }).addTo(map)
  }
  applyBasemap()
  // Layer add-order is z-order (later = on top) — hex first so individual
  // points always render above it and stay clickable in 'both' mode, and
  // locate's overlay/markers last so they sit on top of everything.
  const hexLayer = L.layerGroup().addTo(map)
  const pointLayer = L.layerGroup().addTo(map)
  // highlightLayer sits above the points so the receptions-log playhead ring
  // (setHighlight) is always visible; it is a separate, non-interactive layer
  // so it repaints without a full point rebuild and survives popupOpen guards.
  const highlightLayer = L.layerGroup().addTo(map)
  const locateLayer = L.layerGroup().addTo(map)
  let mode = 'both', here = null, lastIsolatedId = null, onLocateCb = null, locateVisible = true
  let highlightId = null, onMarkerFocusCb = null

  let popupOpen = false
  map.on('popupopen', () => { popupOpen = true })
  map.on('popupclose', () => { popupOpen = false })

  // Follow mode: the map auto-centres on each GPS fix until the user drags the
  // map, then it stops following and a recenter button (wired in app.js) is
  // shown. follow is only released once we have a position to return to, so the
  // button is never offered when recenter would be a no-op.
  // On the first fix we zoom in to ACQUIRE_ZOOM (street level for hunting);
  // after that, follow keeps whatever zoom the user has set.
  const ACQUIRE_ZOOM = 18
  let follow = true, lastPos = null, onFollow = null, acquired = false
  map.on('dragstart', () => {
    if (follow && lastPos) { follow = false; if (onFollow) onFollow(false) }
  })

  function pointStyle(rec, nowMs) {
    const tier = rssiTier(rec.rssi, currentOffset())
    const color = cssVar(tierColorVar(tier))
    // Fade with age within the active time window (#149) — applied to stroke
    // and fill so a nearly-expired point is nearly transparent, not outlined.
    const fade = ageFade(rec.rx_at, nowMs, timeWindowMs)
    return {
      radius: 8,
      color,
      weight: 1,
      opacity: fade,
      fillColor: color,
      fillOpacity: fillOpacity(tier) * fade,
    }
  }

  // Rendering is data-driven (the 1s tick calls render with fresh rows), but the
  // hex resolution depends on the zoom and Leaflet misplaces vector layers if they
  // are torn down and rebuilt mid zoom-animation — the rebuilt polygons miss the
  // animation transform and appear shifted from the basemap until the next
  // reproject. So cache the latest rows, skip rebuilds while a zoom is animating
  // (the existing layers animate correctly), and do one clean rebuild on zoomend.
  let lastRecords = []
  let zooming = false
  map.on('zoomstart', () => { zooming = true })
  map.on('zoomend', () => { zooming = false; draw() })

  function render(records, isolatedId) {
    lastRecords = records
    lastIsolatedId = isolatedId ?? null
    draw()
  }

  // "Locate": estimate a transmitter's position from this hunter's own
  // receptions (RSSI-weighted centroid + density heatmap, same pure algorithm
  // as the multi-hunter web version — see locate.js). Runs over the already-
  // filtered record set the map plots, so it answers "where does the traffic
  // I'm currently looking at come from" — a selected target or any narrowing
  // filter (packet-type, window, …). No API/DB read here, just what this hunter
  // has walked past.
  function drawLocate(records) {
    locateLayer.clearLayers()
    const points = toLocatePoints(records)
    // Always compute — the FAB toggle (setLocateVisible) only hides the
    // rendered overlay/readout, so the estimate is instantly available with
    // no recompute lag whenever the user switches it back on. No points yet
    // (nothing plotted) → no readout rather than a meaningless "0 points".
    const res = points.length ? locate(points) : null
    if (!locateVisible || !res) { if (onLocateCb) onLocateCb(null); return }
    if (res.heatmap) heatmapOverlay(res.heatmap).addTo(locateLayer)
    if (res.centroid) {
      L.marker([res.centroid.lat, res.centroid.lon], {
        icon: L.divIcon({ className: '', html: '<div class="lc-centroid"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).bindTooltip('weighted estimate').addTo(locateLayer)
    }
    if (res.strongest) {
      L.marker([res.strongest.lat, res.strongest.lon], {
        icon: L.divIcon({ className: '', html: '<div class="lc-strongest">★</div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).bindTooltip('strongest reception').addTo(locateLayer)
    }
    if (onLocateCb) onLocateCb(res)
  }
  // onLocate registers a callback invoked with the locate() result (or null
  // when no sender is isolated, or the overlay is toggled off) every render
  // tick — drives the info readout.
  function onLocate(cb) { onLocateCb = cb }
  // setLocateVisible toggles the heatmap/centroid/strongest overlay + info
  // readout on or off without touching the underlying estimate, which keeps
  // running every tick regardless (see drawLocate).
  function setLocateVisible(v) { locateVisible = !!v; draw() }

  function draw() {
    if (popupOpen) return   // don't rebuild markers while the user is inspecting a popup (it would close it)
    if (zooming) return     // mid zoom-animation: keep current layers; zoomend triggers a clean rebuild
    const records = lastRecords
    pointLayer.clearLayers(); hexLayer.clearLayers()
    drawLocate(records)
    // Hex first, points second — Leaflet's SVG renderer stacks paths in
    // insertion order (last = topmost), so drawing hex before points keeps
    // individual points clickable on top of the heatmap in 'both' mode
    // instead of being covered by it.
    if (mode !== 'points') {
      const cells = new Map()
      const res = hexResForZoom(map.getZoom())   // finer cells the more you zoom in
      for (const r of records) {
        if (r.lat == null || r.lon == null) continue
        const id = hexCellAt(r.lat, r.lon, res)
        const cur = cells.get(id)
        if (!cur || (r.rssi ?? -999) > (cur.best ?? -999)) cells.set(id, { best: r.rssi })
      }
      for (const [id, c] of cells) {
        // hexBoundary returns [lat,lon] pairs (closed ring) — directly usable by L.polygon
        const ring = hexBoundary(id); if (!ring) continue
        const tier = rssiTier(c.best, currentOffset())
        L.polygon(ring, { color: cssVar(tierColorVar(tier)), weight: 1,
          fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) }).addTo(hexLayer)
      }
    }
    if (mode !== 'hex') {
      const nowMs = Date.now()
      for (const r of records) {
        if (r.lat == null || r.lon == null) continue
        const m = L.circleMarker([r.lat, r.lon], pointStyle(r, nowMs))
        m.bindPopup(popupHtml(r, lastIsolatedId))
        m.on('popupopen', (e) => { wireIsolate(e.popup, r); wireIgnore(e.popup, r) })
        // Tapping a point rolls the receptions-log playhead to it (#130).
        m.on('click', () => { if (onMarkerFocusCb) onMarkerFocusCb(r) })
        m.addTo(pointLayer)
      }
    }
    applyHighlight()
  }

  // applyHighlight rings the marker for the reception on the log playhead
  // (highlightId). Rebuilt on every draw and on setHighlight so it tracks both
  // new data and playhead moves. Non-interactive, so it never eats point taps.
  function applyHighlight() {
    highlightLayer.clearLayers()
    if (highlightId == null) return
    const r = lastRecords.find((x) => String(x.id) === String(highlightId))
    if (!r || r.lat == null || r.lon == null) return
    L.circleMarker([r.lat, r.lon], { radius: 11, color: cssVar('--ch-accent'), weight: 3, fill: false, interactive: false }).addTo(highlightLayer)
  }
  // setHighlight rings a reception by id (or clears it with null). Cheap — it
  // only rebuilds the highlight layer, not the whole point layer.
  function setHighlight(id) { highlightId = id == null ? null : id; applyHighlight() }
  // onMarkerFocus registers the callback fired with the record when a point is
  // tapped, so app.js can roll the receptions-log playhead to it.
  function onMarkerFocus(cb) { onMarkerFocusCb = cb }
  function setPosition(lat, lon) {
    lastPos = [lat, lon]
    here = here || L.circleMarker([lat, lon], { radius: 6, color: cssVar('--ch-accent'), weight: 2 }).addTo(map)
    here.setLatLng([lat, lon])
    if (follow) {
      map.setView([lat, lon], acquired ? (map.getZoom() ?? ACQUIRE_ZOOM) : ACQUIRE_ZOOM)
      acquired = true
    }
  }
  function centerOn(lat, lon) { map.setView([lat, lon], map.getZoom() ?? 15) }
  // recenter re-enables follow and snaps back to the last known position.
  function recenter() {
    if (!lastPos) return
    follow = true
    map.setView(lastPos, map.getZoom() ?? 15)
    if (onFollow) onFollow(true)
  }
  // onFollowChange registers a callback invoked with the follow flag whenever it
  // flips (false when the user pans away, true on recenter).
  function onFollowChange(cb) { onFollow = cb }
  // setBearing rotates the map to the given bearing (degrees). No-op when the
  // leaflet-rotate plugin didn't load, so the app degrades to north-up.
  let settingBearing = false
  function setBearing(deg) {
    if (typeof map.setBearing !== 'function') return
    settingBearing = true
    try { map.setBearing(deg) } finally { settingBearing = false }
  }
  // onGestureRotate fires only for user-driven rotation (the two-finger
  // gesture), not for our own setBearing calls — app.js uses it to drop out
  // of heading-follow when the user takes over manually.
  function onGestureRotate(cb) {
    map.on('rotate', () => { if (!settingBearing) cb(typeof map.getBearing === 'function' ? map.getBearing() : 0) })
  }
  function setLayerMode(m) { mode = m }
  // setAttenuator updates the runtime attenuator (dB) used in the plot offset.
  // The next render tick repaints with the new tiers.
  function setAttenuator(db) { attenuatorDb = Number(db) || 0 }
  // setTimeWindow mirrors the filter's active time window (ms, or null for no
  // window) so pointStyle can fade points by age within it. The 1s render tick
  // keeps the fade progressing.
  function setTimeWindow(ms) { timeWindowMs = ms == null ? null : Number(ms) || null }
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    centerOn(rec.lat, rec.lon)
    const popup = L.popup({ autoPan: true }).setLatLng([rec.lat, rec.lon]).setContent(popupHtml(rec, lastIsolatedId)).openOn(map)
    wireIsolate(popup, rec)
    wireIgnore(popup, rec)
  }
  function destroy() { map.remove() }
  return { setPosition, centerOn, recenter, onFollowChange, onLocate, setLocateVisible, render, setLayerMode, applyBasemap, focusReception, setAttenuator, setTimeWindow, setBearing, onGestureRotate, setHighlight, onMarkerFocus, destroy }
}

function popupHtml(r, isolatedId) {
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const kindLabel = { channel_name: 'name', advert_pubkey: 'node', discover_pubkey: 'node', relay: 'relay' }[r.sender_kind] || 'src'
  const senderLine = r.sender_id
    ? `${kindLabel} ${esc(r.sender_label || r.sender_id)}`
    : 'sender — (none)'
  const chanLine = r.channel_name ? `<br>channel ${esc(r.channel_name)}` : ''
  const textLine = r._text ? `<br>"${esc(r._text)}"` : ''
  const isolated = r.sender_id && r.sender_id === isolatedId
  const isolateBtn = isolated
    ? `<button class="ch-isolate active" disabled>Isolated ✓</button>`
    : `<button class="ch-isolate" ${r.sender_id ? '' : 'disabled'}>Isolate sender</button>`
  return `<div class="ch-popup">SNR ${esc(r.snr)} · RSSI ${esc(r.rssi)}<br>`
    + `${esc(r.packet_type)}<br>`
    + senderLine + chanLine + textLine + '<br>'
    + isolateBtn
    + ` <button class="ch-ignore" ${r.sender_id ? '' : 'disabled'}>Ignore this ID</button></div>`
}
function wireIsolate(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-isolate')
  if (!btn || !r.sender_id || btn.disabled) return
  // Optimistic feedback: the next render tick will confirm this via
  // popupHtml's isolatedId check, but that tick is 1s away and the popup
  // doesn't rebuild while open (see draw()'s popupOpen guard) — without this,
  // clicking gives no visible response until the popup is closed and reopened.
  btn.onclick = () => {
    document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id: r.sender_id } }))
    btn.textContent = 'Isolated ✓'
    btn.disabled = true
    btn.classList.add('active')
  }
}
function wireIgnore(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-ignore')
  if (btn && r.sender_id) btn.onclick = () => document.dispatchEvent(
    new CustomEvent('hunt:ignore-sender', { detail: { id: r.sender_id } }))
}
