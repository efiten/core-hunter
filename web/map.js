import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { API_BASE } from './config.js'
import { resolveName, cachedName, isFullPubkey, isResolvableId, senderName } from './names.js'
import { locate } from './locate.js'
import { fetchPointsPaged } from './pagedpoints.js'
import * as urlstate from './urlstate.js'
import { initAuthBar } from './login.js'
import { guestNotice, canSeeLocate, canSeeObserverPoints } from './auth.js'

let currentRole = 'guest'

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

// Theme: restore the shared/saved choice (default dark) before drawing so the
// basemap matches. urlstate resolves URL > stored > default.
const BASEMAP = { dark: 'dark_all', light: 'light_all' }
let theme = urlstate.initial('theme', 'dark') === 'light' ? 'light' : 'dark'
document.documentElement.setAttribute('data-theme', theme)

// Initial map view from the shared/saved state (falls back to a Belgium-ish view).
const iLat = parseFloat(urlstate.initial('lat', '')), iLon = parseFloat(urlstate.initial('lon', ''))
const iZoom = parseInt(urlstate.initial('z', ''), 10)
const map = L.map('map', { zoomControl: true }).setView(
  Number.isFinite(iLat) && Number.isFinite(iLon) ? [iLat, iLon] : [51, 4],
  Number.isFinite(iZoom) ? iZoom : 12)
const tileUrl = (t) => `https://{s}.basemaps.cartocdn.com/${BASEMAP[t]}/{z}/{x}/{y}{r}.png`
const tiles = L.tileLayer(tileUrl(theme), { maxZoom: 19 }).addTo(map)
const pointLayer = L.layerGroup().addTo(map)
// Canvas renderer: SVG markers get sluggish past a few thousand; canvas keeps
// the 25k-point layer and large Locate datasets smooth.
const ptCanvas = L.canvas({ padding: 0.5 })
const hexLayer = L.layerGroup().addTo(map)
const locateLayer = L.layerGroup().addTo(map)
const csAdvertLayer = L.layerGroup().addTo(map)
const csRelayLayer = L.layerGroup().addTo(map)
let locateActive = false
let locateTimer = null
// Whether the "?" legend in the Locate info box is expanded. Persisted across
// the box's 5 s re-renders so a poll doesn't collapse it under the user.
let legendOpen = false

// Density-cloud ramp from the --ch-sig-* tokens (warm -> hot only: yellow ->
// orange -> red), so the canvas honours the CSS-variable colour rule. The cold
// end is intentionally excluded — low density is not "cold signal", and a blue
// floor read as a spurious halo around the hotspot. Returns [r,g,b].
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

const MODES = ['points', 'hex', 'both']
// Cold default is hex (#141) — a URL-/persisted mode still wins via urlstate.
let mode = MODES.includes(urlstate.initial('mode', '')) ? urlstate.initial('mode', '') : 'hex'
const bar = document.getElementById('bar')
document.getElementById('layer-toggle').textContent = mode
const setMapTop = () => { document.getElementById('map').style.top = bar.offsetHeight + 'px'; map.invalidateSize() }
setMapTop()
window.addEventListener('resize', setMapTop)

const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

function qs() {
  const b = map.getBounds()
  const p = new URLSearchParams({ bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), z: String(map.getZoom()) })
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  return p.toString()
}

async function drawPoints() {
  pointLayer.clearLayers()
  const { points, capped } = await fetchPointsPaged(qs(), { maxTotal: 25000 })
  const unresolved = new Set()
  for (const pt of points) {
    if (!pt.sender_label && isResolvableId(pt.sender_id) && cachedName(pt.sender_id) === undefined) {
      unresolved.add(pt.sender_id.toLowerCase())
    }
    const role = pt.sender_role ? ` · ${esc(pt.sender_role)}` : ''
    const sid = pt.sender_id || ''
    const idLine = sid ? `<br><span class="pp-id">${esc(sid)}</span>` : ''
    const locBtn = (sid && canSeeLocate(currentRole)) ? `<br><button class="lc-locate" data-sender="${esc(sid)}">Locate this sender</button>` : ''
    const tier = rssiTier(pt.rssi)
    L.circleMarker([pt.lat, pt.lon], { renderer: ptCanvas, radius: 5, color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(senderName(pt))}${role}${idLine}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || pt.packet_type)}<br>${esc(pt.rx_at)}${locBtn}`)
      .addTo(pointLayer)
  }
  document.getElementById('status').textContent = `${points.length} points${capped ? ' (capped)' : ''}`
  // Look up unknown full-pubkey senders once each; redraw if any resolved to a name.
  if (unresolved.size) {
    Promise.all([...unresolved].map((k) => resolveName(k))).then((names) => {
      if (names.some((n) => n)) refresh()
    })
  }
}

async function drawHex() {
  hexLayer.clearLayers()
  const r = await fetch(`${API_BASE}/api/heatmap?${qs()}`); const fc = await r.json()
  for (const f of fc.features || []) {
    const ring = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon])
    const tier = rssiTier(f.properties.best_rssi)
    L.polygon(ring, { color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindTooltip(`best RSSI ${esc(f.properties.best_rssi)} · ${f.properties.count} pts · ${(f.properties.hunters||[]).length} hunters`)
      .addTo(hexLayer)
  }
  document.getElementById('status').textContent = fc.features.length + ' cells' + (fc.truncated ? ' (capped)' : '')
}

function applyLocateGate() {
  const show = canSeeLocate(currentRole)
  const btn = document.getElementById('locate-toggle')
  if (btn) btn.hidden = !show
  if (!show && locateActive) deactivateLocate()
}
// Hides the CS-layer toggle control (and drops its layers) for non-members;
// the server returns 403 for /api/observer-points below member so there is
// nothing useful to show or fetch.
function applyObserverGate() {
  const show = canSeeObserverPoints(currentRole)
  const toggle = document.querySelector('.cs-layer-toggle')
  if (toggle) toggle.hidden = !show
  if (!show) {
    clearObserverLayers()
  } else {
    // Deferred CS-layer deep-link restore (mirrors the Locate restore below):
    // the ?adv=1/?rel=1 checkbox state was applied at module-eval time, before
    // the real role was known, so drawObserverPoints() early-returned then.
    // Redraw only the checked layers now that the gate is open.
    if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
    if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
  }
}

function applyRole(me) {
  currentRole = me.role || 'guest'
  const notice = document.getElementById('guest-notice')
  const msg = guestNotice(currentRole)
  notice.textContent = msg || ''
  notice.title = msg ? 'Guests & hunters see: last 24 h, max 500 recent points, ~1 km positions, anonymised hunters. Members see full data.' : ''
  notice.hidden = !msg
  applyLocateGate()
  applyObserverGate()
  refresh()
  // Deferred ?locate=1 restore (Task 5): fires once, the first time the
  // resolved role can see Locate — including a guest who logs in as a member
  // later, since applyRole() re-runs on login too.
  if (wantLocate && !locateRestored && canSeeLocate(currentRole) && window.currentFilters().sender) {
    locateRestored = true
    activateLocate()
  }
}

let t = null
export function refresh() {
  clearTimeout(t)
  t = setTimeout(() => {
    if (locateActive) return // focus mode: keep the non-relevant layers hidden
    if (mode === 'points' || mode === 'both') drawPoints(); else pointLayer.clearLayers()
    if (mode === 'hex' || mode === 'both') drawHex(); else hexLayer.clearLayers()
  }, 250)
}

document.getElementById('layer-toggle').addEventListener('click', (e) => {
  mode = mode === 'points' ? 'hex' : mode === 'hex' ? 'both' : 'points'
  e.target.textContent = mode
  urlstate.save()
  refresh()
})
const themeBtn = document.getElementById('theme-toggle')
const syncThemeBtn = () => { themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️' }
syncThemeBtn()
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  tiles.setUrl(tileUrl(theme))
  syncThemeBtn()
  urlstate.save()
  refresh() // redraw markers/polygons so they pick up the new --ch-sig-* colors
})

map.on('moveend zoomend', () => { urlstate.save(); refresh() })
window.__refresh = refresh
window.__mapZoom = () => map.getZoom() // test hook

// Paint a normalized density grid to a canvas and return a Leaflet image overlay.
function heatmapOverlay(hm) {
  const { grid, rows, cols, bounds } = hm
  const canvas = document.createElement('canvas')
  canvas.width = cols; canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  const stops = heatStops()
  // Gate out the low-density floor: cells below FLOOR stay fully transparent, so
  // the bounding-box rectangle and faint haze disappear; above it, alpha ramps up.
  const FLOOR = 0.12
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c]
      const y = rows - 1 - r // grid row 0 = south; canvas y=0 = top
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

// Render a full locate result onto locateLayer + the info card.
function renderLocate(points, senderId) {
  if (!locateActive) return
  locateLayer.clearLayers()
  const res = locate(points)
  if (res.heatmap) heatmapOverlay(res.heatmap).addTo(locateLayer)
  // observation points: inliers coloured by RSSI, outliers greyed/dashed
  for (const p of res.inliers) {
    const tier = rssiTier(p.rssi)
    L.circleMarker([p.lat, p.lon], { renderer: ptCanvas, radius: 4, color: cssVar(tierColorVar(tier)), weight: 1,
      fillColor: cssVar(tierColorVar(tier)), fillOpacity: 0.7 }).addTo(locateLayer)
  }
  for (const p of res.outliers) {
    L.circleMarker([p.lat, p.lon], { renderer: ptCanvas, radius: 4, color: cssVar('--ch-sig-none'), weight: 1,
      dashArray: '2,2', fillColor: cssVar('--ch-sig-none'), fillOpacity: 0.2 }).addTo(locateLayer)
  }
  if (res.centroid) {
    L.marker([res.centroid.lat, res.centroid.lon], {
      icon: L.divIcon({ className: '', html: '<div class="lc-centroid"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).bindTooltip('weighted estimate').addTo(locateLayer)
  }
  // strongest reception: where you heard it loudest (closest single sample)
  if (res.strongest) {
    L.marker([res.strongest.lat, res.strongest.lon], {
      icon: L.divIcon({ className: '', html: '<div class="lc-strongest">★</div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).bindTooltip(`strongest reception ${esc(res.strongest.rssi)} dBm`).addTo(locateLayer)
  }
  updateLocateInfo(res, senderId)
}

function updateLocateInfo(res, senderId) {
  const box = document.getElementById('locate-info')
  box.hidden = false
  const s = res.stats
  if (!res.centroid) {
    box.innerHTML = `<h4>Locate</h4><div class="lc-muted">${res.inliers.length} point(s) — too few to estimate (need 3+).</div>`
    return
  }
  const isHash = !!senderId && !isFullPubkey(senderId)
  const radius = s.searchRadiusM != null ? Math.round(s.searchRadiusM) + ' m' : '—'
  const enc = Math.round(s.encirclement * 100)
  const encHint = s.encirclement < 0.5 ? '<div class="lc-warn">One-sided — drive around the estimate to tighten.</div>' : ''
  const hashNote = isHash ? `<div class="lc-warn">1-byte ID — assumed one node; ${res.outliers.length} outlier(s) excluded.</div>` : ''
  const strong = res.strongest ? ` · ★ strongest ${esc(res.strongest.rssi)} dBm` : ''
  box.innerHTML = `<h4>Locate <button type="button" class="lc-help" aria-label="Explain these numbers" aria-expanded="${legendOpen}">?</button></h4>`
    + `<div>${s.n} points · search radius ~${radius} · encircle ${enc}%${strong}</div>`
    + encHint + hashNote
    + `<div class="lc-muted">● weighted estimate · ★ where you heard it loudest. Within driven area · ~hundreds of m · no TX calibration.</div>`
    + locateLegendHtml()
}

// Plain-English legend for the Locate numbers, toggled by the "?" button. Kept
// collapsed by default (hidden unless legendOpen) so the box stays compact; the
// same markup renders on every update so the delegated toggle handler and the
// persisted legendOpen keep it in sync across re-renders.
function locateLegendHtml() {
  return `<dl class="lc-legend"${legendOpen ? '' : ' hidden'}>`
    + `<dt>Points</dt><dd>Receptions used — more points, more reliable.</dd>`
    + `<dt>Search radius</dt><dd>The node is likely within this distance of the ● dot. Smaller = tighter fix.</dd>`
    + `<dt>Encircle</dt><dd>Share of directions you heard it from. Higher = more trustworthy estimate.</dd>`
    + `<dt>★ Strongest</dt><dd>Your loudest reception (dBm). Its marker is the best spot to head toward.</dd>`
    + `</dl>`
}

// Test hook: render a supplied point array (no API needed).
window.__locateRender = (points, senderId = 'efef79') => { locateActive = true; renderLocate(points, senderId) }

// Build a sender-scoped, bbox-less query for /api/points (all of this node's
// receptions across all hunters, full timeframe — not viewport-limited).
function locateQs(f) {
  const p = new URLSearchParams({ sender: f.sender })
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p.toString()
}

async function drawLocate() {
  const f = (window.currentFilters && window.currentFilters()) || {}
  const box = document.getElementById('locate-info')
  if (!f.sender) {
    locateLayer.clearLayers()
    if (locateActive) {
      box.hidden = false
      box.innerHTML = '<h4>Locate</h4><div class="lc-muted">Enter a sender ID to locate.</div>'
    }
    return
  }
  let fetched
  try {
    // Full paged dataset: the solver input and the drawn dots are the same
    // array, so the centroid always sits within the visible cloud.
    fetched = await fetchPointsPaged(locateQs(f), { maxTotal: 100000 })
  } catch (e) {
    if (locateActive) {
      box.hidden = false
      box.innerHTML = '<h4>Locate</h4><div class="lc-muted">Could not load points — retrying…</div>'
    }
    return
  }
  const points = fetched.points.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi }))
  // When a CoreScope layer is shown, count that node's CoreScope sightings too —
  // resilient (a failed source just contributes nothing).
  const tf = (f.from ? '&from=' + encodeURIComponent(f.from) : '') + (f.to ? '&to=' + encodeURIComponent(f.to) : '')
  const hk = encodeURIComponent(f.sender)
  const extra = []
  if (canSeeObserverPoints(currentRole)) {
    if (csAdvertCb.checked) extra.push(`${API_BASE}/api/observer-points?heard_key=${hk}&src=advert${tf}`)
    if (csRelayCb.checked) extra.push(`${API_BASE}/api/observer-points?heard_key=${hk}&src=rxlog${tf}`)
  }
  if (extra.length) {
    const res = await Promise.all(extra.map((u) => fetch(u).then((r) => (r.ok ? r.json() : { points: [] })).catch(() => ({ points: [] }))))
    for (const rr of res) for (const p of rr.points || []) points.push({ lat: p.lat, lon: p.lon, rssi: p.rssi })
  }
  renderLocate(points, f.sender)
}

const locateBtn = document.getElementById('locate-toggle')
function activateLocate() {
  if (!canSeeLocate(currentRole)) return
  if (locateActive) { drawLocate(); return }
  locateActive = true
  locateBtn.classList.add('on')
  // focus mode: hide every non-relevant layer so only the located node shows
  pointLayer.clearLayers(); hexLayer.clearLayers(); csAdvertLayer.clearLayers(); csRelayLayer.clearLayers()
  urlstate.save()
  drawLocate()
  locateTimer = setInterval(drawLocate, 5000)
}
function deactivateLocate() {
  locateActive = false
  locateBtn.classList.remove('on')
  clearInterval(locateTimer); locateTimer = null
  locateLayer.clearLayers()
  document.getElementById('locate-info').hidden = true
  urlstate.save()
  refresh() // restore points/hex per mode
  if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
  if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
}
locateBtn.addEventListener('click', () => (locateActive ? deactivateLocate() : activateLocate()))

// "Locate this sender" button inside a point popup: set the sender filter to the
// clicked node's ID and start (or refresh) a Locate for it.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.lc-locate')
  if (!btn) return
  document.getElementById('f-sender').value = btn.dataset.sender
  map.closePopup()
  activateLocate()
})

// "?" toggle in the Locate info box: expand/collapse the plain-English legend.
// Flips it in place (no full re-render) and remembers the state for the next poll.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.lc-help')
  if (!btn) return
  legendOpen = !legendOpen
  btn.setAttribute('aria-expanded', String(legendOpen))
  const leg = document.querySelector('#locate-info .lc-legend')
  if (leg) leg.hidden = !legendOpen
})

// --- CoreScope mobile-observer layers (two optional toggles, default off) ---
// Timeframe-scoped (from/to), not bbox; the heard_key resolves to the node /
// repeater name. Relays (last-hop repeaters) drawn as a ring to distinguish them
// from the solid advert (zero-hop node) dots.
async function drawObserverPoints(src, layer, ring) {
  if (!canSeeObserverPoints(currentRole)) return
  layer.clearLayers()
  const f = (window.currentFilters && window.currentFilters()) || {}
  const p = new URLSearchParams({ src })
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  let d
  try {
    const r = await fetch(`${API_BASE}/api/observer-points?${p}`)
    if (!r.ok) return
    d = await r.json()
  } catch { return }
  // The checkbox may have been unchecked while this fetch was in flight —
  // bail so a late response doesn't re-populate a layer the user just turned
  // off (the toggle already cleared it and dropped adv/rel from the URL).
  if (!csCbForSrc(src).checked) { layer.clearLayers(); return }
  const unresolved = new Set()
  for (const pt of d.points || []) {
    const id = (pt.heard_key || '').toLowerCase()
    if (isResolvableId(id) && cachedName(id) === undefined) unresolved.add(id)
    const tier = rssiTier(pt.rssi)
    const col = cssVar(tierColorVar(tier))
    const name = (isResolvableId(id) && cachedName(id)) || id || '—'
    const hk = pt.heard_key || ''
    const idLine = hk ? `<br><span class="pp-id">${esc(hk)}</span>` : ''
    const locBtn = (hk && canSeeLocate(currentRole)) ? `<br><button class="lc-locate" data-sender="${esc(hk)}">Locate this sender</button>` : ''
    const opts = ring
      ? { radius: 6, color: col, weight: 2, fillColor: col, fillOpacity: 0.12 }
      : { radius: 4, color: col, weight: 1, fillColor: col, fillOpacity: fillOpacity(tier) }
    L.circleMarker([pt.lat, pt.lon], opts)
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>${ring ? 'relay' : 'node'} ${esc(name)}${idLine}<br>observer ${esc(pt.observer)}<br>${esc(pt.rx_at)}${locBtn}`)
      .addTo(layer)
  }
  if (unresolved.size) {
    Promise.all([...unresolved].map((k) => resolveName(k))).then((names) => {
      // Same guard as above: don't redraw for a layer that's been switched off
      // (or gone into Locate focus) while the names were resolving.
      if (names.some((n) => n) && csCbForSrc(src).checked && !locateActive) drawObserverPoints(src, layer, ring)
    })
  }
}

const csAdvertCb = document.getElementById('cs-adverts')
const csRelayCb = document.getElementById('cs-relays')
const csCbForSrc = (src) => (src === 'advert' ? csAdvertCb : csRelayCb)
// Drops both CS observer layers and resets their checkboxes — used when the
// gate hides the toggle so a later role change doesn't reveal a stale-checked
// control with a cleared layer.
function clearObserverLayers() {
  csAdvertLayer.clearLayers(); csRelayLayer.clearLayers()
  csAdvertCb.checked = false; csRelayCb.checked = false
}
function toggleCsLayer(cb, src, layer, ring) {
  if (locateActive) { drawLocate(); return } // focus mode: feed Locate, not the all-nodes layer
  cb.checked ? drawObserverPoints(src, layer, ring) : layer.clearLayers()
}
csAdvertCb.addEventListener('change', () => toggleCsLayer(csAdvertCb, 'advert', csAdvertLayer, false))
csRelayCb.addEventListener('change', () => toggleCsLayer(csRelayCb, 'rxlog', csRelayLayer, true))
// On timeframe change: feed Locate if active, else redraw the all-nodes CS layers
// (they are timeframe-scoped, not bbox-scoped — so no redraw on pan/zoom).
for (const id of ['f-from', 'f-to']) {
  const el = document.getElementById(id)
  if (el) el.addEventListener('change', () => {
    if (locateActive) { drawLocate(); return }
    if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
    if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
  })
}

// Clear button: reset every filter to its default, drop the CS observer layers,
// leave Locate, then redraw + persist (empty values fall out of the URL).
document.getElementById('clear-filters').addEventListener('click', () => {
  if (window.__resetFilters) window.__resetFilters()
  csAdvertCb.checked = false; csRelayCb.checked = false
  csAdvertLayer.clearLayers(); csRelayLayer.clearLayers()
  if (locateActive) deactivateLocate() // restores points/hex per mode
  refresh()
  urlstate.save()
})

// Hover the sender box to see the resolved node name (if known): resolve the
// typed prefix (debounced) and stash it in the input's native tooltip.
const senderEl = document.getElementById('f-sender')
let senderTitleTimer = null
function updateSenderTitle() {
  const v = senderEl.value.trim().toLowerCase()
  if (!isResolvableId(v)) { senderEl.title = ''; return }
  const c = cachedName(v)
  if (c !== undefined) { senderEl.title = c || ''; return }
  resolveName(v).then((n) => { if (senderEl.value.trim().toLowerCase() === v) senderEl.title = n || '' })
}
senderEl.addEventListener('input', () => { clearTimeout(senderTitleTimer); senderTitleTimer = setTimeout(updateSenderTitle, 300) })

// --- Shareable URL + localStorage persistence -------------------------------
// Register every setting once. A new setting only needs one register() /
// bindControl() line here to be reflected in the URL and restored next visit.
urlstate.register({ key: 'theme', get: () => theme,
  set: (v) => { if (v === 'light' || v === 'dark') { theme = v; document.documentElement.setAttribute('data-theme', theme); tiles.setUrl(tileUrl(theme)); syncThemeBtn() } } })
urlstate.register({ key: 'mode', get: () => mode,
  set: (v) => { if (MODES.includes(v)) { mode = v; document.getElementById('layer-toggle').textContent = mode } } })
// Map view: applied synchronously at construction (top of file); here we only
// need the getters so pan/zoom lands in the URL and storage.
urlstate.register({ key: 'lat', get: () => map.getCenter().lat.toFixed(5), set: () => {} })
urlstate.register({ key: 'lon', get: () => map.getCenter().lng.toFixed(5), set: () => {} })
urlstate.register({ key: 'z', get: () => String(map.getZoom()), set: () => {} })
urlstate.bindControl('hunter', 'f-hunter')
urlstate.bindControl('sender', 'f-sender', { events: ['change', 'input'] })
urlstate.bindControl('from', 'f-from')
urlstate.bindControl('to', 'f-to')
urlstate.bindControl('adv', 'cs-adverts', { checkbox: true })
urlstate.bindControl('rel', 'cs-relays', { checkbox: true })
urlstate.bindControl('direct', 'f-direct', { checkbox: true })
urlstate.register({ key: 'types', get: () => window.currentTypes(), set: (v) => window.setTypes(v) })
const wantLocate = urlstate.initial('locate', '') === '1'
let locateRestored = false // wantLocate fires at most once, see applyRole() below
urlstate.register({ key: 'locate', get: () => (locateActive ? '1' : ''), set: () => {} }) // restored below

urlstate.load()
updateSenderTitle() // tooltip for a sender restored from the URL/storage

// Restore state that a value alone does not trigger (checkbox draw, locate focus).
// A ?locate=1 restore is NOT triggered here: currentRole is still the 'guest'
// default at this point (initAuthBar()'s fetchMe() below hasn't resolved yet),
// so activateLocate()'s role gate would always block it. That restore is
// deferred into applyRole(), once the real role is known.
if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
refresh()

// Role-aware boot: fetch /api/auth/me, wire the auth bar, and re-apply
// role-dependent UI (guest notice + Tasks 5/9 gating) whenever it changes.
initAuthBar(applyRole)
