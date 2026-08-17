import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { API_BASE } from './config.js'
import { resolveName, cachedName, isFullPubkey, isResolvableId, senderName } from './names.js'
import { locate, toLocatePoints } from './locate.js'
import { groupSenderPoints, circleRing, isRegistryIdKind, nodeRows } from './nodelayer.js'
import { fetchPointsPaged } from './pagedpoints.js'
import { latestWins } from './latestwins.js'
import { deferWhile } from './deferredredraw.js'
import * as urlstate from './urlstate.js'
import { initAuthBar } from './login.js'
import { guestNotice, canSeeLocate, canSeeObserverPoints, isDegradedFor } from './auth.js'
import { packetTypeLabel } from './packettypes.js'
import { createTargetPicker, encodeSelection, decodeSelection, withoutSenderFilters } from './targetpicker.js'
import { createMultiSelectPicker, wirePopover } from './multiselect.js'
import { hunterOptionLabel, hunterList, topHunters, withoutHunterFilter } from './hunterpicker.js'
import { QUICK_RANGES, matchQuickRange, rangeLabel, resolveTimeValue, absoluteShareUrl, isTimeToken, toLocalInput, boundFromField, exceedsGuestWindow } from './timerange.js'
import { createReceptionTicker, receptionKey, tickerFilters, isLiveWindow, newestInRing, CAP as RX_CAP } from './receptionticker.js'

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

// A name-resolution redraw clears its layer, and removing a marker closes its
// popup — so a popup opened just before a background lookup finished would
// vanish under the cursor (#271). Hold those redraws while a popup is open and
// run the last one when it closes. Only automatic redraws go through this: a
// redraw the user asked for (filter, pan, layer toggle) closing a popup is
// expected behaviour.
let popupOpen = false
const nameRedraw = deferWhile(() => popupOpen)
map.on('popupopen', () => { popupOpen = true })
map.on('popupclose', () => {
  popupOpen = false
  // Deferred a tick, and flush() re-checks: Leaflet removes the previous popup
  // before adding the next one, so clicking straight from one marker to
  // another fires popupclose while the next popup is already opening. Flushing
  // synchronously there would clear the layer out from under it — this bug,
  // one interaction later.
  setTimeout(() => nameRedraw.flush(), 0)
})
// Target-list picker (#223), created near the end of this file once its DOM
// exists; refreshPickerCandidates() (called from refresh()) feeds it on every
// redraw in all modes, guarded since it's still null during the handful of
// calls that can happen before that point.
let targetPicker = null
// Declared here rather than at the wiring site below: refreshPickerCandidates()
// reads it, and a `const` further down would be in its temporal dead zone --
// reading it would throw rather than fall through the null guard if a redraw
// ever lands before module eval reaches the wiring.
let senderPicker = null
// Hunter picker (#290): the same shape, generalized from the sender picker.
// refreshHunterPickerCandidates() (called from refresh()) feeds it on every
// redraw; declared here for the same TDZ reason as targetPicker/senderPicker.
let hunterPicker = null
let hunterPanel = null
const nodePosLayer = L.layerGroup().addTo(map)
// Reception ticker (#224) two-way sync support: a distinct, non-interactive
// highlight ring for whatever reception is on the ticker's playhead. The
// ticker's own onActiveChange callback already carries the full point (lat/
// lon included, since it comes straight from the ticker's own fetch), so no
// separate lookup table is needed here — only a marker click needs a key,
// computed inline via receptionKey (the API returns no row id to key on).
const rxHighlightLayer = L.layerGroup().addTo(map)
let rxTicker = null
function setRxHighlight(rec) {
  rxHighlightLayer.clearLayers()
  // Locate is a focus mode that hides every non-relevant layer; the ticker's own
  // 5s poll keeps running, so without this it would paint an unrelated sender's
  // ring back onto that view within one interval.
  if (!rec || locateActive) return
  L.circleMarker([rec.lat, rec.lon], {
    renderer: ptCanvas, radius: 9, weight: 2, color: cssVar('--ch-accent'), fill: false, interactive: false,
  }).addTo(rxHighlightLayer)
}
let locateActive = false
let locateTimer = null
let timeRangeTimer = null
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
// #rx-log (#224) shares this: it also sits below the bar, and a wrapped bar
// (more filter chips than fit on one line, or a narrow viewport) grows taller
// than any fixed offset would assume -- keep both in sync with the bar's
// actual rendered height, not a guessed constant.
const setMapTop = () => {
  document.getElementById('map').style.top = bar.offsetHeight + 'px'
  const rxLog = document.getElementById('rx-log')
  if (rxLog) rxLog.style.top = (bar.offsetHeight + 4) + 'px'
  map.invalidateSize()
}
setMapTop()
window.addEventListener('resize', setMapTop)

const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

// The two sender filters travel on two params (#223): `sender` is the
// free-text leading-prefix search, `senders` (repeated) is the target-list
// picker's exact multi-id selection. Separate params rather than one
// delimiter-joined value, because sender_id is arbitrary operator text for
// channel_name senders and no delimiter is safe to overload (#288). The server
// applies either as a real SQL condition (filterFrom in
// server/internal/httpapi/api.go), so this stays a plain pass-through -- no
// client-side narrowing, and hex/heatmap honours a multi-sender pick exactly
// like the point layer does.
function qs() {
  const b = map.getBounds()
  const p = new URLSearchParams({ bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), z: String(map.getZoom()) })
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) {
    // senderPairs is already [key, value][] and may repeat a key (#223), so it
    // appends rather than sets -- URLSearchParams.set would keep only the last.
    if (k === 'senderPairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  return p.toString()
}

// The layers are rebuilt off-map and swapped in one go, rather than cleared
// before the fetch: clearing first leaves the map empty for a whole round-trip
// after every pan/zoom, which reads as flicker (#317). Markers are built into
// a local array and only added once the data they represent has arrived.
// mayPaint() also covers Locate: activateLocate() empties both layers for its
// focus view, so a draw that was already in flight must not repaint over it —
// refresh() is suppressed for the whole Locate session, so a stray repaint
// would stay on screen until the user pans (drawObserverPoints guards the
// same way).
const pointsDraw = latestWins()
const hexDraw = latestWins()
const mayPaint = (isCurrent) => isCurrent() && !locateActive
const setStatus = (text) => { document.getElementById('status').textContent = text }

async function drawPoints() {
  const isCurrent = pointsDraw()
  let points, capped
  try {
    ({ points, capped } = await fetchPointsPaged(qs(), { maxTotal: 25000 }))
  } catch (_) {
    // The layer is no longer cleared up front, so a failed fetch would
    // otherwise leave the previous bbox's points and count sitting there as
    // if they were the answer.
    if (mayPaint(isCurrent)) { pointLayer.clearLayers(); setStatus('points unavailable') }
    return
  }
  if (!mayPaint(isCurrent)) return
  const markers = []
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
    const marker = L.circleMarker([pt.lat, pt.lon], { renderer: ptCanvas, radius: 5, color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(senderName(pt))}${role}${idLine}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || packetTypeLabel(pt.packet_type))}<br>${esc(pt.rx_at)}${locBtn}`)
    // Reception ticker two-way sync (#224): clicking a marker scrolls the
    // ticker to the matching line, keyed by receptionKey since /api/points
    // rows carry no stable id.
    marker.on('click', () => { if (rxTicker) rxTicker.focusRecord(receptionKey(pt)) })
    markers.push(marker)
  }
  pointLayer.clearLayers()
  for (const m of markers) m.addTo(pointLayer)
  setStatus(`${points.length} points${capped ? ' (capped)' : ''}`)
  // Look up unknown full-pubkey senders once each; redraw if any resolved to a
  // name — but not out from under an open popup (#271).
  if (unresolved.size) {
    Promise.all([...unresolved].map((k) => resolveName(k))).then((names) => {
      if (names.some((n) => n)) nameRedraw.run('points', () => refresh())
    })
  }
}

// A multi-sender pick restricts the heatmap too (#223): the sender filter is
// applied server-side in SQL, so it lands before the grid-cell aggregation
// rather than needing per-point rows the client no longer sees.
async function drawHex() {
  const isCurrent = hexDraw()
  let fc
  try {
    const r = await fetch(`${API_BASE}/api/heatmap?${qs()}`)
    if (!r.ok) throw new Error(`heatmap ${r.status}`)
    fc = await r.json()
  } catch (_) {
    if (mayPaint(isCurrent)) { hexLayer.clearLayers(); setStatus('heatmap unavailable') }
    return
  }
  if (!mayPaint(isCurrent)) return
  const cells = []
  for (const f of fc.features || []) {
    const ring = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon])
    const tier = rssiTier(f.properties.best_rssi)
    const cell = L.polygon(ring, { color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindTooltip(`best RSSI ${esc(f.properties.best_rssi)} · ${f.properties.count} pts · ${(f.properties.hunters||[]).length} hunters`)
    // Ticker sync from hex mode (#224). The marker-click path only exists in
    // 'points'/'both', and the cold default is 'hex' (#141), so without this a
    // first-time visitor clicking the map got nothing. A cell is an aggregate
    // with no reception of its own, so match it against the rows the ticker
    // already holds; newestInRing returns null when it holds none of them
    // (ordinary — it caps at CAP recent rows), and then the ticker is left as
    // it is rather than jumped somewhere arbitrary.
    cell.on('click', () => {
      if (!rxTicker) return
      const hit = newestInRing(rxTicker.records(), ring)
      if (hit) rxTicker.focusRecord(receptionKey(hit))
    })
    cells.push(cell)
  }
  hexLayer.clearLayers()
  for (const c of cells) c.addTo(hexLayer)
  setStatus(fc.features.length + ' cells' + (fc.truncated ? ' (capped)' : ''))
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
    nodePosLayer.clearLayers(); nodePosSig = null
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
  // Hide quick ranges that exceed the guest 24h cap for guest/hunter roles
  const isGuest = isDegradedFor(currentRole)   // same rule the server applies (degrade.go)
  for (const [label, li] of Object.entries(quickRangeElements)) {
    const exceedsGuestCap = ['Last 2 days', 'Last 7 days', 'Last 30 days'].includes(label)
    li.hidden = isGuest && exceedsGuestCap
  }
  applyLocateGate()
  applyObserverGate()
  // The range label depends on the role (#300), and this runs after
  // /api/auth/me resolves — at module-eval time currentRole is still the
  // 'guest' default, so without this a member keeps the clamp note.
  syncTimeUi()
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
    // The else branches take a ticket as well as clearing: a draw started
    // under the previous mode is obsolete the moment the toggle empties its
    // layer, and would otherwise still be the newest and repaint it.
    if (mode === 'points' || mode === 'both') drawPoints(); else { pointsDraw(); pointLayer.clearLayers() }
    if (mode === 'hex' || mode === 'both') drawHex(); else { hexDraw(); hexLayer.clearLayers() }
    // Picker works in all modes, not just points mode (#288 blocker 1)
    refreshPickerCandidates()
    refreshHunterPickerCandidates()
    drawNodePositions()   // follows the same filter/bbox set as the points
    if (rxTicker) rxTicker.refetch() // same trigger points as the map (#224)
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
window.__mapProject = (lat, lon) => map.latLngToContainerPoint([lat, lon]) // test hook

// Bbox-less query carrying every active filter (hunter/sender/time/types/hops)
// as-is -- for anything that needs the full matching dataset rather than
// what's currently panned into view. Shared by the hunter snap (#195) and the
// no-sender Locate path (#176).
function filtersQs() {
  const p = new URLSearchParams()
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) {
    // senderPairs is already [key, value][] and may repeat a key (#223), so it
    // appends rather than sets -- URLSearchParams.set would keep only the last.
    if (k === 'senderPairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  return p.toString()
}

// The target picker (#223) needs the sender-UNfiltered candidate set: it must
// offer every sender in the current hunter/time/type/hops window to pick from,
// not just the ones already picked. Now that the server applies the sender
// filter for real, drawPoints()'s result set is already narrowed -- feeding
// that to the picker would shrink the list to the current selection and make
// picking a second sender impossible. So the picker runs its own query with
// `sender` dropped. Bbox-scoped like the map itself, the same limitation
// snapToLatestPoints (#218) has and the issue anticipated.
//
// Only fetched while the panel is actually open -- an extra request on every
// redraw would be pure waste for a control that is closed almost all the time.
let cachedCandidatePoints = []
let cachedCandidatureSig = null
async function refreshPickerCandidates() {
  if (!targetPicker || !senderPicker || senderPicker.hidden) return
  const b = map.getBounds()
  const p = new URLSearchParams({ bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), z: String(map.getZoom()) })
  // The candidate pool is sender-independent by construction, so both the
  // signature and the query drop the sender filters (#288 blocker 4) — see
  // withoutSenderFilters. Keeping them would shrink the list you are picking
  // from as you pick, and refetch 25k rows on every checkbox click.
  const f = withoutSenderFilters((window.currentFilters && window.currentFilters()) || {})
  const sig = [...Object.entries(f).map(([k, v]) => `${k}=${v}`), `bbox=${p.get('bbox')}`, `z=${p.get('z')}`].sort().join('&')
  if (sig === cachedCandidatureSig) {
    // Filter unchanged, just re-render with current selection state
    targetPicker.render(cachedCandidatePoints, Date.now())
    return
  }
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  try {
    const { points } = await fetchPointsPaged(p.toString(), { maxTotal: 25000 })
    cachedCandidatePoints = points
    cachedCandidatureSig = sig
    targetPicker.render(points, Date.now())
  } catch (_) { /* keep the last good list; retried on the next redraw */ }
}

// The hunter picker (#290) needs the same shape, mirroring refreshPickerCandidates()
// above: its Top section ranks by recent activity, so it needs a hunter-
// UNfiltered candidate point set -- otherwise a hunter you already picked would
// never surface a newly-relevant one in the ranking. Bbox-scoped, only fetched
// while the panel is open, same reasoning as the sender picker's candidate query.
let cachedHunterCandidatePoints = []
let cachedHunterCandidateSig = null
async function refreshHunterPickerCandidates() {
  if (!hunterPicker || !hunterPanel || hunterPanel.hidden) return
  const b = map.getBounds()
  const p = new URLSearchParams({ bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(','), z: String(map.getZoom()) })
  const f = withoutHunterFilter((window.currentFilters && window.currentFilters()) || {})
  const sig = [...Object.entries(f).map(([k, v]) => `${k}=${v}`), `bbox=${p.get('bbox')}`, `z=${p.get('z')}`].sort().join('&')
  if (sig === cachedHunterCandidateSig) {
    hunterPicker.render(cachedHunterCandidatePoints, Date.now())
    return
  }
  // senderPairs is [key, value][] and may repeat a key (#223) -- unlike the
  // sender candidate query, withoutHunterFilter does not drop it, so it needs
  // the same append handling filtersQs() uses.
  for (const [k, v] of Object.entries(f)) {
    if (k === 'senderPairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  try {
    const { points } = await fetchPointsPaged(p.toString(), { maxTotal: 25000 })
    cachedHunterCandidatePoints = points
    cachedHunterCandidateSig = sig
    hunterPicker.render(points, Date.now())
  } catch (_) { /* keep the last good list; retried on the next redraw */ }
}

// Single newest-first page for the reception ticker (#224) -- the server
// already orders /api/points by rx_at DESC (server/internal/store/query.go),
// so limit=CAP&offset=0 is exactly "the newest CAP receptions", no pagination
// loop needed (unlike fetchPointsPaged, built for the much larger point-layer
// fetch).
async function fetchTickerPage(mode) {
  const filters = tickerFilters((window.currentFilters && window.currentFilters()) || {}, mode)
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    // senderPairs is [key, value][] and may repeat a key (#223), so append it
    // the way qs() does -- p.set would stringify the array into one garbage value.
    if (k === 'senderPairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  p.set('limit', String(RX_CAP)); p.set('offset', '0')
  const r = await fetch(`${API_BASE}/api/points?${p.toString()}`)
  if (!r.ok) throw new Error(`points ${r.status}`)
  const d = await r.json()
  return d.points || []
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
// Fired from the hunter picker's onChange (#290) -- wired further down, once
// the picker exists, same reasoning as the sender picker's onChange.
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
function locateQs(f, sender) {
  const p = new URLSearchParams({ sender })
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p.toString()
}

// Locate estimates one node, so it needs a single sender id. #223 split the
// two sender inputs into senderPairs (picked ids, or one typed prefix), so
// derive it from there: exactly one pair means one node either way. A
// multi-select has no single node to locate, so it falls through to the
// filter-scoped path, the same as when no sender is set at all.
function locateSender(f) {
  const pairs = f.senderPairs || []
  return pairs.length === 1 ? pairs[0][1] : ''
}

// Locate estimates over a selected sender, or -- when no sender is set --
// whatever else narrows the view (hunter/types/hops/time), mirroring the
// app's filtered-record Locate (#176, follow-up to #128).
async function drawLocate() {
  const f = (window.currentFilters && window.currentFilters()) || {}
  const sender = locateSender(f)
  const box = document.getElementById('locate-info')
  let fetched
  try {
    // Full paged dataset: the solver input and the drawn dots are the same
    // array, so the centroid always sits within the visible cloud.
    fetched = await fetchPointsPaged(sender ? locateQs(f, sender) : filtersQs(), { maxTotal: 100000 })
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
  if (sender) {
    // When a CoreScope layer is shown, count that node's CoreScope sightings too —
    // resilient (a failed source just contributes nothing).
    const tf = (f.from ? '&from=' + encodeURIComponent(f.from) : '') + (f.to ? '&to=' + encodeURIComponent(f.to) : '')
    const hk = encodeURIComponent(sender)
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
  renderLocate(points, sender)
}

const locateBtn = document.getElementById('locate-toggle')
function activateLocate() {
  if (!canSeeLocate(currentRole)) return
  if (locateActive) { drawLocate(); return }
  locateActive = true
  locateBtn.classList.add('on')
  // focus mode: hide every non-relevant layer so only the located node shows.
  // nodePosSig has to go with the layer it describes: leaving it set means the
  // redraw after Locate recomputes the same signature, takes the early return,
  // and never repopulates — the layer would stay empty for the rest of the
  // session. One clear, one reset.
  pointLayer.clearLayers(); hexLayer.clearLayers(); csAdvertLayer.clearLayers(); csRelayLayer.clearLayers()
  nodePosLayer.clearLayers(); nodePosSig = null
  rxHighlightLayer.clearLayers() // suppress ticker rings in focus mode (#287 blocker 3)
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
const observerDraw = { advert: latestWins(), rxlog: latestWins() }

async function drawObserverPoints(src, layer, ring) {
  if (!canSeeObserverPoints(currentRole)) return
  const isCurrent = observerDraw[src]()
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
  // locateActive for the same reason: Locate clears both CS layers for its
  // focus view and suppresses refresh() for the whole session, so a late
  // response would repaint into it and stay there. Reachable deterministically
  // from the popup's own "Locate this sender" button, which closes the popup
  // (releasing a held redraw) before activating Locate.
  if (!csCbForSrc(src).checked || locateActive) { layer.clearLayers(); return }
  // Two draws of the same layer can overlap — a held redraw released by a
  // popupclose while an explicit one (filter change, checkbox) is mid-fetch.
  // The layer is cleared before the fetch, so both responses would append and
  // the layer would end up with every marker twice.
  if (!isCurrent()) return
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
      // (or gone into Locate focus) while the names were resolving. The guard
      // moved inside the callback because the redraw can now be held until a
      // popup closes (#271) — by then, either may have changed.
      if (!names.some((n) => n)) return
      // Keyed per source: the advert and relay layers redraw independently and
      // are never redrawn by a pan or a filter change, so sharing one slot
      // would drop one of them silently rather than defer it.
      nameRedraw.run(`cs:${src}`, () => {
        if (csCbForSrc(src).checked && !locateActive) drawObserverPoints(src, layer, ring)
      })
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
// Signature of what is currently drawn. Rebuilding the layer destroys every
// marker, which silently closes any popup the user has open — and this layer
// redraws on each refresh (pan, zoom, filter change, the name-resolution
// pass), so an unguarded rebuild can yank a popup away mid-read. Skip the
// rebuild when the rendered content is identical, mirroring targetlist.js's
// _lastSig guard in the app.
let nodePosSig = null

// Fetches the registry slice for the current viewport from the server's bulk
// proxy (#377). Same-origin, member-gated server-side; a failure returns null
// and the caller leaves the layer alone rather than emptying it.
async function fetchNodeRegistry() {
  const b = map.getBounds()
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(',')
  try {
    const r = await fetch(`${API_BASE}/api/nodes/positions?bbox=${encodeURIComponent(bbox)}`, { credentials: 'same-origin' })
    if (!r.ok) return null
    return await r.json()
  } catch (_) {
    return null
  }
}

async function drawNodePositions() {
  const gen = ++nodePosGen
  const note = document.getElementById('nodepos-note')
  if (note) note.hidden = !nodePosCb.checked
  if (!nodePosCb.checked || !canSeeObserverPoints(currentRole)) {
    nodePosLayer.clearLayers(); nodePosSig = null
    return
  }
  // The registry is what decides which nodes are drawn (#377). It used to be
  // the filtered reception set, which meant the layer could only ever show
  // nodes this filter happened to match — the website, with the bigger screen
  // and the multi-hunter picture, was a strict subset of the app on the one
  // layer where it should be a superset. The receptions are still fetched, but
  // now only to pair an estimate onto a node the registry already places.
  const [registry, pointsRes] = await Promise.all([
    fetchNodeRegistry(),
    fetchPointsPaged(qs(), { maxTotal: 25000 }),
  ])
  // A newer draw started (or the layer was switched off) while we were waiting.
  if (gen !== nodePosGen || !nodePosCb.checked) return
  if (!registry) return   // registry unreachable: leave the last good layer up
  const points = pointsRes.points

  // Only a full-pubkey reception may pair with a registry node. A discover
  // reply carries a 2+ byte PREFIX, and this side is handed a viewport slice,
  // so "unique among the nodes on screen" is a weaker claim than the app's
  // "unique in the whole registry" — a prefix ambiguous two towns over would
  // look unique here. AGENTS.md §7 keeps the website out of prefix-to-identity
  // resolution (#296), and having a registry slice does not change that.
  const pairable = points.filter((pt) => isRegistryIdKind(pt.sender_kind) && isFullPubkey(String(pt.sender_id)))
  const draw = nodeRows(registry.nodes, groupSenderPoints(pairable))
    // estimate-only cannot occur here (every row has an advertised position by
    // construction), but 'none' can if a registry row arrives unplottable.
    .filter((r) => r.p.kind !== 'none')

  // No dedupe pass: every row is keyed by a distinct full pubkey from the
  // registry, and two distinct pubkeys are two physically distinct nodes. A
  // coordinate-based dedupe would only ever fire on two repeaters sharing a
  // mast, which is ordinary in a mesh, and would hide one of them (#272).
  const deduped = draw

  const sig = deduped.map((d) => [d.id, d.name, d.p.kind, Math.round(d.p.driftM ?? -1),
    Math.round(d.p.circle ? d.p.circle.radiusM : -1),
    d.est ? `${d.est.centroid.lat.toFixed(5)},${d.est.centroid.lon.toFixed(5)}` : ''].join(':')).join('|')
  if (sig === nodePosSig) return   // nothing changed — leave the layer (and any open popup) alone
  nodePosSig = sig
  nodePosLayer.clearLayers()

  for (const { id, advertised, est, p, name } of deduped) {
    const color = cssVar(driftColorVar(p))
    const html = nodePosPopup(name, id, p, est)
    // The name rides on the map next to the ▲, not just in the popup: the
    // layer is opt-in, so it can afford the labels while it is on. Only the ▲
    // is labelled — the ● is the same node.
    const label = `<span class="np-label">${esc(name || cachedName(id) || id.slice(0, 6))}</span>`
    L.marker([advertised.lat, advertised.lon], {
      icon: L.divIcon({ className: 'np-advert-icon', html: `<div class="np-advert" style="color:${color}">▲${label}</div>`, iconSize: [14, 16] }),
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

// ---------------------------------------------------------------------------
// Time-range picker (#285)
// ---------------------------------------------------------------------------
// #f-from/#f-to remain the state carriers (urlstate-bound, urlOnly per #217);
// this panel is only a nicer way to write them. Quick ranges store relative
// tokens verbatim, so the range keeps following now -- see timerange.js.
const trToggle = document.getElementById('tr-toggle')
const trPanel = document.getElementById('time-picker')
const trLabelEl = document.getElementById('tr-label')
const trQuick = document.getElementById('tr-quick')
const trFromEl = document.getElementById('tr-from')
const trToEl = document.getElementById('tr-to')
const fFrom = document.getElementById('f-from')
const fTo = document.getElementById('f-to')

// The absolute fields are datetime-local and cannot display a token, so show
// the token's *resolved* instant: opening the panel on "Last 6 hours" pre-fills
// the concrete window it currently means, and editing from there naturally
// converts the range to absolute.
// What syncTimeUi last wrote into each absolute field, as { value, iso }. The
// displayed string is a lossy rendering of the instant (see toLocalInput), so
// the instant is kept alongside it and boundFromField reuses it when the field
// comes back untouched.
const trRendered = { from: null, to: null }

function syncTimeUi() {
  const now = Date.now()
  // Say so when the server is going to clamp this, rather than labelling a
  // range the data does not cover (#300). Hiding the >24h rows only stops a
  // guest picking one; a shared ?from=now-7d link still lands here.
  const clamped = isDegradedFor(currentRole) && exceedsGuestWindow(fFrom.value, fTo.value, now)
  trLabelEl.textContent = rangeLabel(fFrom.value, fTo.value, now) + (clamped ? ' (24 h max)' : '')
  const active = matchQuickRange(fFrom.value, fTo.value)
  for (const li of trQuick.children) li.classList.toggle('active', !!active && li.dataset.label === active.label)
  const f = resolveTimeValue(fFrom.value, now), t = resolveTimeValue(fTo.value, now)
  // Don't rewrite the absolute fields while the panel is open. Skipping only the
  // focused element is not enough: filling two datetime-local fields routinely
  // takes longer than the 10 s relative-range tick, so the field you already
  // finished gets reverted (and trRendered with it) while you type in the other,
  // and Apply then submits a value you never chose. openTimePicker() re-syncs on
  // every open, so nothing is stale when the panel is next shown.
  if (!trPanel.hidden) return
  const writeField = (elm, iso, slot) => {
    elm.value = iso ? toLocalInput(Date.parse(iso)) : ''
    trRendered[slot] = iso ? { value: elm.value, iso } : null
  }
  writeField(trFromEl, f, 'from')
  writeField(trToEl, t, 'to')
}

// Start/stop the timer to re-resolve relative ranges so they follow "now".
// Runs every 10s while a relative range is active to keep token-based windows rolling.
// Also refreshes the data so the map shows the current rolling window (#289 blocker 2).
function updateTimeRangeTimer() {
  const isRelative = isTimeToken(fFrom.value) || isTimeToken(fTo.value)
  if (isRelative && !timeRangeTimer) {
    timeRangeTimer = setInterval(() => { syncTimeUi(); refresh() }, 10000)
  } else if (!isRelative && timeRangeTimer) {
    clearInterval(timeRangeTimer)
    timeRangeTimer = null
  }
}

// Write a range into the carriers and fire the same 'change' every other
// filter fires, so urlstate.save(), refresh() and the CS-layer/Locate hooks
// all run exactly as they do for a hand-edited field.
function applyRange(from, to) {
  fFrom.value = from; fTo.value = to
  fFrom.dispatchEvent(new Event('change', { bubbles: true }))
  fTo.dispatchEvent(new Event('change', { bubbles: true }))
  urlstate.save()
  syncTimeUi()
  updateTimeRangeTimer()
}

// Update timer when filters change (including manual edits to absolute fields).
fFrom.addEventListener('change', updateTimeRangeTimer)
fTo.addEventListener('change', updateTimeRangeTimer)

const quickRangeElements = {}
for (const q of QUICK_RANGES) {
  const li = document.createElement('li')
  li.className = 'tr-item'; li.dataset.label = q.label
  const b = document.createElement('button')
  b.type = 'button'; b.textContent = q.label
  b.addEventListener('click', () => { applyRange(q.from, q.to); closeTimePicker() })
  li.appendChild(b)
  quickRangeElements[q.label] = li
  trQuick.appendChild(li)
}

document.getElementById('tr-apply').addEventListener('click', () => {
  // Read the fields back through boundFromField so an untouched field keeps the
  // instant it was rendered from (#289 blocker 4). Re-parsing the displayed
  // string cannot do this: on the DST fall-back night it always resolves to the
  // first pass through the ambiguous hour, so Apply with no edits moved the
  // window an hour into the past.
  applyRange(boundFromField(trFromEl.value, trRendered.from), boundFromField(trToEl.value, trRendered.to))
  closeTimePicker()
})

// The escape hatch that pairs with storing tokens (#285): copy a link whose
// range is frozen to concrete timestamps, so it reproduces exactly for whoever
// opens it instead of following their now.
document.getElementById('tr-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget
  const url = absoluteShareUrl(location.href, fFrom.value, fTo.value, Date.now())
  try {
    await navigator.clipboard.writeText(url)
    btn.textContent = 'Copied!'
  } catch (_) {
    btn.textContent = 'Copy failed'
  }
  setTimeout(() => { btn.textContent = 'Copy absolute link' }, 1500)
})

// Sync while still hidden: syncTimeUi() only writes the absolute fields when the
// panel is closed, so the order matters — populate, then show.
function openTimePicker() { syncTimeUi(); trPanel.hidden = false; trToggle.setAttribute('aria-expanded', 'true') }
function closeTimePicker() { trPanel.hidden = true; trToggle.setAttribute('aria-expanded', 'false') }
trToggle.addEventListener('click', () => (trPanel.hidden ? openTimePicker() : closeTimePicker()))
// Capture phase, same reason as elsewhere: a quick-range click re-renders rows
// under the pointer, so a bubble-phase listener can see a detached target.
document.addEventListener('click', (e) => {
  if (trPanel.hidden) return
  if (e.target.closest('.tr-wrap')) return
  closeTimePicker()
}, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !trPanel.hidden) closeTimePicker() })
window.__syncTimeUi = syncTimeUi // test hook

// Clear button: reset every filter to its default, drop the CS observer layers,
// leave Locate, then redraw + persist (empty values fall out of the URL).
document.getElementById('clear-filters').addEventListener('click', () => {
  if (window.__resetFilters) window.__resetFilters()
  // The picks live in the pickers, not in #f-sender or a native select, so
  // resetFilters() cannot see either — without this the senders=/hunter=
  // filters survive Clear with no UI trace.
  targetPicker.setSelected([])
  hunterPicker.setSelected([])
  syncHunterToggleLabel()
  csAdvertCb.checked = false; csRelayCb.checked = false
  csAdvertLayer.clearLayers(); csRelayLayer.clearLayers()
  if (locateActive) deactivateLocate() // restores points/hex per mode
  refresh()
  urlstate.save()
  syncTimeUi() // Clear rewrites from/to -> the picker label must follow (#285)
  // ...and so must the tick: resetFilters() assigns .value directly, so coming
  // from a relative range the timer would otherwise keep firing refresh() every
  // 10 s against the static absolute default it just restored.
  updateTimeRangeTimer()
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
// The hunter selection is a Set, not a single input's .value (#196; the
// picker itself since #290), so it can't use bindControl -- register
// directly, mirroring 'types'.
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
// Captured before load(): the picker is wired further down (it needs the DOM),
// so 'senders' is not a registered field yet when load() normalizes the address
// bar — and normalizing drops unregistered keys, taking a pasted ?senders= with
// it. Same shape as wantLocate below, applied once the picker exists.
const initialSenders = urlstate.initial('senders', '')
const wantLocate = urlstate.initial('locate', '') === '1'
let locateRestored = false // wantLocate fires at most once, see applyRole() below
urlstate.register({ key: 'locate', get: () => (locateActive ? '1' : ''), set: () => {} }) // restored below

urlstate.load()
// urlstate applies from/to by assigning .value, which fires no change event, so
// the listeners that normally arm the tick never run. Without this a shared
// /?from=now-1h&to=now link — the whole point of storing tokens — renders the
// label "Last 1 hour" and then freezes at load time.
updateTimeRangeTimer()
updateSenderTitle() // tooltip for a sender restored from the URL/storage

// Restore state that a value alone does not trigger (checkbox draw, locate focus).
// A ?locate=1 restore is NOT triggered here: currentRole is still the 'guest'
// default at this point (initAuthBar()'s fetchMe() below hasn't resolved yet),
// so activateLocate()'s role gate would always block it. That restore is
// deferred into applyRole(), once the real role is known.
if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
if (!hasSavedView) snapToLatestPoints() // #218 -- only when nothing to restore
syncTimeUi() // label the picker button from the restored/default range (#285)
refresh()

// Target-list picker (#223): a small dropdown beside #f-sender, a "toggle
// button reveals a panel" shape rather than app's full sheet -- web's top bar
// keeps every control inline (#225 decision), so this stays a compact
// popover, not a sheet. The hunter picker below (#290) shares the same shape.
const spToggle = document.getElementById('sp-toggle')
senderPicker = document.getElementById('sender-picker')
targetPicker = createTargetPicker('f-sender', document.getElementById('tp-list'), {
  pinnedEl: document.getElementById('tp-pinned'),
  // The picker owns its selection now (#288), so the field's own input/urlstate
  // wiring no longer carries it -- refresh and persist explicitly instead.
  onChange: () => { urlstate.save(); refresh() },
})
// currentFilters (filters.js) reads the selection through this rather than
// importing the picker, keeping the filter module free of DOM-component wiring.
window.selectedSenderIds = () => targetPicker.getSelected()
// Typing a prefix while a pick is active used to do nothing at all: ids take
// absolute precedence in senderParams, and only the pick->type direction
// cleared the other side. The input accepted the text, the map ignored it, and
// nothing said why (#299). Typing is an explicit act, so let it win — the same
// direction the pick already has when it clears the field.
document.getElementById('f-sender').addEventListener('input', (e) => {
  if (!e.target.value.trim()) return
  if (!targetPicker.getSelected().length) return
  targetPicker.setSelected([])
  urlstate.save()
  refresh()
})

// Selection persists as JSON: a sender_id is arbitrary operator text, so the
// stored form can no more be delimiter-joined than the query params can (#288).
urlstate.register({ key: 'senders',
  get: () => encodeSelection(targetPicker.getSelected()),
  set: (v) => targetPicker.setSelected(decodeSelection(v)) })
// load() already ran, so apply the pre-load capture now that the field exists.
if (initialSenders) targetPicker.setSelected(decodeSelection(initialSenders))
// Open/close + outside-click/Escape (#223) is shared with the hunter picker
// below via wirePopover (#290) -- see multiselect.js for why outside-click
// runs in the capture phase.
wirePopover({
  toggleEl: spToggle, panelEl: senderPicker, wrapEl: spToggle.closest('.ms-wrap'), wrapSelector: '.ms-wrap',
  onOpen: () => { targetPicker.reset(); refresh() }, // back to page 1; the next redraw repopulates
})

// Hunter picker (#290): generalizes the sender picker's pattern to #f-hunter,
// replacing the native <select multiple> -- no on-screen hint that ctrl/cmd
// +click picked more than one, and no visual kinship with the sender picker
// sitting right next to it. Row content differs (name (count), no RSSI/time-
// ago), and the Top section is ranked by recent activity, not RSSI, since a
// hunter has no signal-strength concept -- see hunterpicker.js.
const hpToggle = document.getElementById('hp-toggle')
hunterPanel = document.getElementById('hunter-picker')
let hunterRoster = []
const hunterAdapter = {
  idOf: (h) => h.hunter_pubkey,
  rowParts: (h) => ({ primary: hunterOptionLabel(h), secondary: '', meta: [] }),
  sigOf: (h) => `${h.hunter_pubkey}|${h.hunter_name}|${h.count}`,
  list: (_, { limit } = {}) => hunterList(hunterRoster, { limit }),
  pinned: (points, { count } = {}) => topHunters(hunterRoster, points, { count }),
}
// The toggle is the only thing on screen once the panel closes, so it has to
// carry the selection: a static "Hunters ▾" looked identical whether the map
// was filtered or not, while ?hunter=… sat in the URL. The <select multiple>
// this replaced showed the picked option text, so this was a regression, and
// it is the same failure the Clear-button comment above warns about (#290).
// Must be called from every path that changes the selection: a pick, Clear,
// and the deep-link restore in loadHunterRoster.
function syncHunterToggleLabel() {
  const n = hunterPicker.getSelected().length
  hpToggle.textContent = n ? `Hunters (${n}) ▾` : 'Hunters ▾'
  hpToggle.classList.toggle('has-selection', n > 0)
}

hunterPicker = createMultiSelectPicker(hunterAdapter, document.getElementById('hp-list'), {
  pinnedEl: document.getElementById('hp-pinned'),
  onChange: () => { syncHunterToggleLabel(); urlstate.save(); refresh(); snapToHunter() },
})
// currentFilters/currentHunters (filters.js) read the selection through this,
// same indirection as window.selectedSenderIds.
window.selectedHunterIds = () => hunterPicker.getSelected()
window.setHunterSelection = (v) => {
  hunterPicker.setSelected(String(v || '').split(',').filter(Boolean))
  syncHunterToggleLabel()
}
wirePopover({
  toggleEl: hpToggle, panelEl: hunterPanel, wrapEl: hpToggle.closest('.ms-wrap'), wrapSelector: '.ms-wrap',
  // Render from the roster immediately, before refresh()'s 250ms-debounced
  // /api/points round-trip. Without it, opening the panel showed an empty list
  // until that call landed -- and forever if it failed, since the list needs no
  // points to be built.
  onOpen: () => { hunterPicker.reset(); hunterPicker.render(cachedHunterCandidatePoints, Date.now()); refresh() },
})

// Hunter roster (#290) -- fetched once; the picker's row labels and Top-
// section ranking both read it through the hunterRoster closure above.
async function loadHunterRoster() {
  try {
    const r = await fetch(`${API_BASE}/api/hunters`); const d = await r.json()
    hunterRoster = d.hunters || []
    // The shared/saved selection can only be applied once the roster exists
    // (it arrives async). Re-assert it and fire the same save/refresh/snap
    // effects a user pick would, so the view + URL pick it up. Read the value
    // captured before load (index.html), not initial('hunter') here -- by now
    // urlstate.load()'s save() has already normalized the URL/storage to the
    // still-empty live selection and would return '' (#196).
    const want = String(window.__initialHunter || '').split(',').filter(Boolean)
    if (want.length) {
      hunterPicker.setSelected(want)
      syncHunterToggleLabel()
      urlstate.save(); refresh(); snapToHunter()
    }
    // Render on arrival regardless of the selection. hunterAdapter.list reads
    // hunterRoster and needs no points at all, but refreshHunterPickerCandidates
    // -- which was the only other caller -- early-returns when the panel is
    // hidden and swallows fetch failures. So /api/points 500ing (or the panel
    // being opened before /api/hunters resolves) left "Top" over a permanently
    // empty list, with nothing to re-render it until an unrelated pan or zoom.
    // Pre-PR the options came from /api/hunters alone; this restores that.
    hunterPicker.render(cachedHunterCandidatePoints, Date.now())
  } catch (_) {}
}
loadHunterRoster()

// Reception ticker (#224) -- created once, available to every role (the
// server already applies guest/member windowing to /api/points itself, same
// as the map's own point layer). Wired both ways: onActiveChange highlights
// the corresponding map point; drawPoints() (above) wires the reverse,
// marker-click -> focusRecord.
rxTicker = createReceptionTicker('rx-log', {
  fetchFiltered: () => fetchTickerPage('filtered'),
  fetchAll: () => fetchTickerPage('all'),
  shouldPoll: () => isLiveWindow((window.currentFilters && window.currentFilters().to) || '', Date.now()),
  onActiveChange: setRxHighlight,
})
window.__rxTicker = rxTicker // test hook
window.__rxHighlightCount = () => rxHighlightLayer.getLayers().length // test hook
window.__rxHighlightLatLng = () => { // test hook
  const layers = rxHighlightLayer.getLayers()
  return layers.length ? layers[0].getLatLng() : null
}

// Role-aware boot: fetch /api/auth/me, wire the auth bar, and re-apply
// role-dependent UI (guest notice + Tasks 5/9 gating) whenever it changes.
initAuthBar(applyRole)
