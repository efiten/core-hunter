import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { API_BASE } from './config.js'
import { resolveName, cachedName, cachedPosition, isFullPubkey, isResolvableId, senderName } from './names.js'
import { locate, toLocatePoints } from './locate.js'
import { groupSenderPoints, estimateFor, driftPresentation, circleRing } from './nodelayer.js'
import { fetchPointsPaged } from './pagedpoints.js'
import * as urlstate from './urlstate.js'
import { initAuthBar } from './login.js'
import { guestNotice, canSeeLocate, canSeeObserverPoints } from './auth.js'
import { packetTypeLabel } from './packettypes.js'

let currentRole = 'guest'

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

// Theme: restore the shared/saved choice (default dark) before drawing so the
// basemap matches. urlstate resolves URL > stored > default.
const BASEMAP = { dark: 'dark_all', light: 'light_all' }
let theme = urlstate.initial('theme', 'dark') === 'light' ? 'light' : 'dark'
document.documentElement.setAttribute('data-theme', theme)

// Initial map view from the shared/saved state. With no saved/URL view (#218),
// start on a neutral world view -- not tied to any one region -- and let
// snapToLatestPoints() below fit to today's actual data once it's fetched.
const iLat = parseFloat(urlstate.initial('lat', '')), iLon = parseFloat(urlstate.initial('lon', ''))
const iZoom = parseInt(urlstate.initial('z', ''), 10)
const hasSavedView = Number.isFinite(iLat) && Number.isFinite(iLon)
// Zoom keeps its own independent fallback (a shared link can carry z= without
// lat/lon, e.g. to set a default zoom level) -- only the center changes.
const map = L.map('map', { zoomControl: true }).setView(
  hasSavedView ? [iLat, iLon] : [20, 0],
  Number.isFinite(iZoom) ? iZoom : (hasSavedView ? 12 : 2))
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
const nodePosLayer = L.layerGroup().addTo(map)
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
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(senderName(pt))}${role}${idLine}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || packetTypeLabel(pt.packet_type))}<br>${esc(pt.rx_at)}${locBtn}`)
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
  // Node positions ride the same member gate: the resolve proxy strips lat/lon
  // below member, so the layer could only ever be empty for a guest — hide the
  // control rather than offering a toggle that does nothing.
  const npToggle = document.querySelector('.np-layer-toggle')
  if (npToggle) npToggle.hidden = !show
  if (!show) {
    nodePosCb.checked = false
    nodePosLayer.clearLayers()
    const note = document.getElementById('nodepos-note')
    if (note) note.hidden = true
  }
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
  // later, since applyRole() re-runs on login too. No longer requires a
  // sender (#176) -- Locate now also runs on other filters, or even the bare
  // default view, same as the app.
  if (wantLocate && !locateRestored && canSeeLocate(currentRole)) {
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
    drawNodePositions()   // follows the same filter/bbox set as the points
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
window.__mapCenter = () => map.getCenter() // test hook

// Bbox-less query carrying every active filter (hunter/sender/time/types/hops)
// as-is -- for anything that needs the full matching dataset rather than
// what's currently panned into view. Shared by the hunter snap (#195) and the
// no-sender Locate path (#176).
function filtersQs() {
  const p = new URLSearchParams()
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  return p.toString()
}

// Snap the map to the selected hunter(s) (#195).
let hunterMarker = null
async function snapToHunter() {
  const n = (window.currentHunters ? window.currentHunters() : '').split(',').filter(Boolean).length
  if (n === 0) {
    // "All hunters": drop the marker, no forced viewport change.
    if (hunterMarker) { map.removeLayer(hunterMarker); hunterMarker = null }
    return
  }
  let fetched
  try {
    fetched = await fetchPointsPaged(filtersQs(), { maxTotal: 25000 })
  } catch (_) { return }
  if (hunterMarker) { map.removeLayer(hunterMarker); hunterMarker = null }
  const points = fetched.points
  if (!points.length) return
  map.fitBounds(points.map((p) => [p.lat, p.lon]))
  if (n === 1) {
    // Newest-first (server default order, #142) -> points[0] is the latest
    // reception. This is the hunter phone's own GPS, not a target position.
    const latest = points[0]
    hunterMarker = L.marker([latest.lat, latest.lon])
      .bindPopup(`${esc(latest.hunter_name)} · hunter's own GPS (not a target position)`)
      .addTo(map)
  }
  // #196 pairing decision: >1 hunter selected -> fit to the union, no marker.
}
document.getElementById('f-hunter').addEventListener('change', snapToHunter)
window.__hunterMarkerLatLng = () => (hunterMarker ? hunterMarker.getLatLng() : null) // test hook

// Fit the map to today's actual points on first load when there's no
// saved/URL view yet (#218) -- same fetch-and-fitBounds shape as
// snapToHunter() above, fired once instead of on a filter change. Leaves the
// neutral world-view placeholder in place if there's no data to fit to yet.
async function snapToLatestPoints() {
  let fetched
  try {
    fetched = await fetchPointsPaged(filtersQs(), { maxTotal: 25000 })
  } catch (_) { return }
  if (fetched.points.length) map.fitBounds(fetched.points.map((p) => [p.lat, p.lon]))
}
window.__snapToLatestPoints = snapToLatestPoints // test hook

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

// AGENTS.md §7: any output implying a target's location must state it is
// inferred from radio measurements, not GPS-tracked. Web-side counterpart of
// the app's SPLASH_DISCLAIMER, adapted for the multi-hunter context.
const LOCATE_DISCLAIMER =
  'Mapping radio signals (RSSI/SNR), not GPS tracking of the target: the map shows where hunters were when they heard it.'

function updateLocateInfo(res, senderId) {
  const box = document.getElementById('locate-info')
  box.hidden = false
  const s = res.stats
  const disclaimer = `<div class="lc-muted lc-disclaimer">${LOCATE_DISCLAIMER}</div>`
  if (!res.centroid) {
    box.innerHTML = `<h4>Locate</h4><div class="lc-muted">${res.inliers.length} point(s) — too few to estimate (need 3+).</div>`
      + disclaimer
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
    + disclaimer
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

// Sender-scoped, bbox-less query for /api/points (all of this node's
// receptions across all hunters, full timeframe — not viewport-limited).
// Deliberately narrower than filtersQs(): when a sender is set, Locate keeps
// today's exact behaviour (sender + time only), unchanged by #176.
function locateQs(f) {
  const p = new URLSearchParams({ sender: f.sender })
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p.toString()
}

// Locate estimates over a selected sender, or -- when no sender is set --
// whatever else narrows the view (hunter/types/hops/time), mirroring the
// app's filtered-record Locate (#176, follow-up to #128).
async function drawLocate() {
  const f = (window.currentFilters && window.currentFilters()) || {}
  const box = document.getElementById('locate-info')
  let fetched
  try {
    // Full paged dataset: the solver input and the drawn dots are the same
    // array, so the centroid always sits within the visible cloud.
    fetched = await fetchPointsPaged(f.sender ? locateQs(f) : filtersQs(), { maxTotal: 100000 })
  } catch (e) {
    if (locateActive) {
      box.hidden = false
      box.innerHTML = '<h4>Locate</h4><div class="lc-muted">Could not load points — retrying…</div>'
    }
    return
  }
  const points = toLocatePoints(fetched.points)
  // CoreScope observer-points are keyed on a single heard_key -- they only
  // make sense to merge in when locating one specific sender (#176).
  if (f.sender) {
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
      // Glossary (#174): 'observer' -> 'hunter' (our own term for the capturer);
      // 'relay'/'node' left as-is, tied to the CS-relays/CS-adverts toggle wording
      // (CoreScope's own source distinction, not our sender/repeater glossary).
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>${ring ? 'relay' : 'node'} ${esc(name)}${idLine}<br>hunter ${esc(pt.observer)}<br>${esc(pt.rx_at)}${locBtn}`)
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

// --- Node-position layer (#197) ---------------------------------------------
// Draws each sender's self-advertised position (▲) against our RSSI estimate
// (●), with the gap between them as drift. Positions come from the same
// same-origin resolve proxy the names already use — which strips lat/lon below
// the member role server-side, so a guest simply gets no positions and the
// layer stays empty. Unlike the app (which bulk-fetches the whole registry),
// web only covers senders present in the current filter set; registry-wide
// coverage would need a bulk proxy endpoint on the Go server.
const nodePosCb = document.getElementById('f-nodepos')

// Colour states the rule that produced them, never a verdict on which position
// is "right": the advertised one is operator-self-reported and can be stale.
function driftColorVar(p) {
  if (p.kind === 'tight') return '--ch-accent'
  if (p.kind === 'drifted' && p.outsideCircle) return '--ch-accent-2'
  return '--ch-muted'
}

function nodePosPopup(name, id, p, est) {
  const markers = p.kind === 'advertised-only' ? '▲ advertised' : '▲ advertised · ● estimated'
  const drift = p.driftM != null ? `<br>drift ${Math.round(p.driftM)} m · ${est ? est.n : 0} points` : ''
  const circle = p.circle
    ? `<br>${p.circle.kind === 'search'
        ? `search radius ~${Math.round(p.circle.radiusM)} m`
        : 'one-sided — radius not trusted'}`
    : ''
  return `${esc(name || id)}<br><span class="pp-id">${esc(id)}</span><br>${markers}${drift}${circle}`
    + `<br><span class="np-caveat">Advertised position is self-reported by the operator and may be stale.</span>`
}

// Generation token: a draw can be re-entered while its /api/points fetch is in
// flight (the checkbox, a refresh, and the name-resolution redraw all trigger
// one). Without this the later pass clears the layer and both then add their
// markers, leaving duplicates behind.
let nodePosGen = 0

async function drawNodePositions() {
  const gen = ++nodePosGen
  nodePosLayer.clearLayers()
  const note = document.getElementById('nodepos-note')
  if (note) note.hidden = !nodePosCb.checked
  if (!nodePosCb.checked || !canSeeObserverPoints(currentRole)) return
  const { points } = await fetchPointsPaged(qs(), { maxTotal: 25000 })
  // A newer draw started (or the layer was switched off) while we were waiting.
  if (gen !== nodePosGen || !nodePosCb.checked) return
  const bySender = groupSenderPoints(points)

  // Resolve any sender we have not looked up yet, then redraw once — same
  // fill-only, at-most-once-per-key pattern the name lookups already use.
  const unresolved = [...bySender.keys()].filter((k) => isResolvableId(k) && cachedPosition(k) === undefined)
  if (unresolved.length) {
    Promise.all(unresolved.map((k) => resolveName(k))).then(() => { if (nodePosCb.checked) drawNodePositions() })
  }

  for (const [id, pts] of bySender) {
    const advertised = cachedPosition(id) || null
    const est = estimateFor(pts)
    const p = driftPresentation({ advertised, estimate: est })
    // estimate-only adds nothing here: the points themselves already show it,
    // and Locate draws the centroid properly. Only advertised positions are new.
    if (p.kind === 'none' || p.kind === 'estimate-only') continue
    const color = cssVar(driftColorVar(p))
    const html = nodePosPopup(cachedName(id), id, p, est)
    L.marker([advertised.lat, advertised.lon], {
      icon: L.divIcon({ className: 'np-advert-icon', html: `<div class="np-advert" style="color:${color}">▲</div>`, iconSize: [14, 16] }),
    }).bindPopup(html).addTo(nodePosLayer)
    if (!est || !est.centroid) continue
    L.circleMarker([est.centroid.lat, est.centroid.lon], { radius: 5, color, weight: 2, fillColor: color, fillOpacity: 0.9 })
      .bindPopup(html).addTo(nodePosLayer)
    L.polyline([[advertised.lat, advertised.lon], [est.centroid.lat, est.centroid.lon]], { color, weight: 1.5, opacity: 0.9 })
      .addTo(nodePosLayer)
    if (p.circle) {
      const ring = circleRing(est.centroid, p.circle.radiusM).map(([lon, lat]) => [lat, lon])
      if (ring.length) L.polyline(ring, { color, weight: 1.2, opacity: 0.8, dashArray: p.circle.kind === 'search' ? '4 4' : '1 3' }).addTo(nodePosLayer)
    }
  }
}

nodePosCb.addEventListener('change', () => { drawNodePositions() })

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
// f-hunter is a <select multiple> (#196); .value only returns the first
// selection, so it can't use bindControl -- register directly, mirroring 'types'.
urlstate.register({ key: 'hunter', get: () => window.currentHunters(), set: (v) => window.setHunters(v) })
urlstate.bindControl('sender', 'f-sender', { events: ['change', 'input'] })
// urlOnly (#217): from/to must never be silently restored from a stale saved
// value on a plain revisit -- only an explicit ?from=&to= in the URL may show
// something other than today. Still reflected into the URL for sharing.
urlstate.bindControl('from', 'f-from', { urlOnly: true })
urlstate.bindControl('to', 'f-to', { urlOnly: true })
urlstate.bindControl('adv', 'cs-adverts', { checkbox: true })
urlstate.bindControl('rel', 'cs-relays', { checkbox: true })
urlstate.bindControl('direct', 'f-direct', { checkbox: true })
urlstate.bindControl('nodepos', 'f-nodepos', { checkbox: true })
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
if (!hasSavedView) snapToLatestPoints() // #218 -- only when nothing to restore
refresh()

// Role-aware boot: fetch /api/auth/me, wire the auth bar, and re-apply
// role-dependent UI (guest notice + Tasks 5/9 gating) whenever it changes.
initAuthBar(applyRole)
