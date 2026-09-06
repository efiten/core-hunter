import { tierColorVar } from './signal.js'
import { createWebMap } from './mapcore.js'
import { leafletZoom, mapZoomFromLeaflet, pointFeatures, hexFeatures, observerFeatures, locateFeatures, heatImageData, imageCoordinates, latLonBounds } from './mapmodel.js'
import { API_BASE } from './config.js'
import { resolveName, cachedName, isFullPubkey, isResolvableId, senderName, resolvableKey } from './names.js'
import { loadSeenRole, saveSeenRole, roleRose, roleNotice } from './rolechange.js'
import { locate, toLocatePoints } from './locate.js'
import { groupSenderPoints, circleRing, isRegistryIdKind, nodeRows } from './nodelayer.js'
import { nodePosPresentation, registryStatusFor, NODEPOS_GLANCE_MS } from './nodeposnotice.js'
import { unclutteredLabels, createLabelMeasurer } from './nodelabels.js'
import { fetchPointsPaged } from './pagedpoints.js'
import { latestWins } from './latestwins.js'
import { deferWhile } from './deferredredraw.js'
import * as urlstate from './urlstate.js'
import { initAuthBar } from './login.js'
import { guestNotice, canSeeLocate, canSeeObserverPoints, isDegradedFor, fetchMe, canSeePointLayer, modeForRole, pointLayerReason } from './auth.js'
import { packetTypeLabel } from './packettypes.js'
import { createTargetPicker, encodeSelection, decodeSelection, withoutSenderFilters, withoutIgnoreFilter, senderList, targetParts, relTime, targetChipLabel } from './targetpicker.js'
import { loadIgnore, saveIgnore, toggleIgnore, isIgnored, ignoreParams } from './ignorelist.js'
import { createMultiSelectPicker, wirePopover, placePopover } from './multiselect.js'
import { activeFilterCount } from './barfilters.js'
import { hunterOptionLabel, hunterList, topHunters, withoutHunterFilter } from './hunterpicker.js'
import { QUICK_RANGES, COLD_START_RANGE, matchQuickRange, rangeLabelFor, rangeForRole, rangeIsLive, coverageLabel, coverageTitle, oldestRxAt, resolveTimeValue, absoluteShareUrl, toLocalInput, boundFromField } from './timerange.js'
import { createReceptionTicker, receptionKey, tickerFilters, isLiveWindow, newestInRing, CAP as RX_CAP } from './receptionticker.js'
import { initialPlacement, clampToViewport, serialise, parse as parsePlacement } from './tickerplace.js'

let currentRole = 'guest'

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

// Theme: restore the shared/saved choice (default dark) before drawing so the
// basemap matches. urlstate resolves URL > stored > default.
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
// The map is MapLibre since #465, the app's map (mapcore.js). ?z= keeps
// Leaflet's zoom numbers so every shared link lands where it did; the
// conversion happens here and in leafletZoom() on the way out.
const wm = createWebMap('map', {
  center: hasSavedView ? [iLat, iLon] : [20, 0],
  zoom: Number.isFinite(iZoom) ? mapZoomFromLeaflet(iZoom) : (hasSavedView ? 11 : 1),
  theme,
})
const tierColor = (tier) => cssVar(tierColorVar(tier))
// The two CoreScope layers are named by their source (mapcore.js); the
// call sites below pass these names where they used to pass layer groups.
const csAdvertLayer = 'observer-advert'
const csRelayLayer = 'observer-rxlog'
// Redraw everything data-bearing once the layers exist. The first refresh()
// lands before the style has loaded; mapcore replays what it was handed, and
// this covers what is drawn from the current state rather than a fetch.
wm.onOverlaysReady(() => { refresh() })

// A name-resolution redraw clears its layer, and removing a marker closes its
// popup — so a popup opened just before a background lookup finished would
// vanish under the cursor (#271). Hold those redraws while a popup is open and
// run the last one when it closes. Only automatic redraws go through this: a
// redraw the user asked for (filter, pan, layer toggle) closing a popup is
// expected behaviour.
let popupOpen = false
const nameRedraw = deferWhile(() => popupOpen)
wm.onPopup((open) => {
  popupOpen = open
  // Deferred a tick, and flush() re-checks: opening a popup from another
  // closes the first one before the next is open, so a synchronous flush on
  // close would clear the layer out from under it — this bug, one
  // interaction later.
  if (!open) setTimeout(() => nameRedraw.flush(), 0)
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
// Reception ticker (#224) two-way sync support: a distinct, non-interactive
// highlight ring for whatever reception is on the ticker's playhead. The
// ticker's own onActiveChange callback already carries the full point (lat/
// lon included, since it comes straight from the ticker's own fetch), so no
// separate lookup table is needed here — only a marker click needs a key,
// computed inline via receptionKey (the API returns no row id to key on).
let rxTicker = null
let rxHighlightAt = null
function setRxHighlight(rec) {
  // Locate is a focus mode that hides every non-relevant layer; the ticker's own
  // 5s poll keeps running, so without this it would paint an unrelated sender's
  // ring back onto that view within one interval.
  rxHighlightAt = rec && !locateActive ? { lat: rec.lat, lng: rec.lon } : null
  wm.setData('rxhighlight', rxHighlightAt
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [rec.lon, rec.lat] }, properties: {} }] }
    : null)
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

const MODES = ['points', 'hex', 'both']
// Cold default is hex (#141) — a URL-/persisted mode still wins via urlstate.
let mode = MODES.includes(urlstate.initial('mode', '')) ? urlstate.initial('mode', '') : 'hex'
const bar = document.getElementById('bar')
// The layer mode is a segmented control in the filter panel (#539): one
// button per mode, the active one pressed, instead of a cycling button whose
// label was the only trace of where you were in the cycle.
const syncLayerSeg = () => {
  for (const b of document.querySelectorAll('#layer-seg button')) {
    const on = b.dataset.mode === mode
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', String(on))
  }
}
syncLayerSeg()
// A wrapped bar -- more filter chips than fit on one line, or a narrow viewport
// -- grows taller than any fixed offset would assume, so the map's top comes
// from the bar's actual rendered height rather than a guessed constant.
const setMapTop = () => {
  document.getElementById('map').style.top = bar.offsetHeight + 'px'
  wm.syncSize()
}
setMapTop()
window.addEventListener('resize', setMapTop)

// #rx-log (#224) sits below the bar too, but it is published as a token and
// observed, because it is the one whose staleness steals clicks: at z-index 620
// over the bar's 600 it sat on the bar's last row and swallowed everything meant
// for the bar's last-row control (#386) -- #settings-btn since #420. The bar
// keeps growing after module load -- the packet
// chips render, the role notice arrives with /api/auth/me, the node counts and
// the server version land later still -- and each one wraps another row, so one
// measurement is stale within a second of load and only a resize repaired it.
//
// Deliberately not wired to #map, which stays on the resize-driven path above:
// it follows the bar when the window changes, and not when the bar's own
// content grows. That asymmetry is the point. invalidateSize moves the centre
// coordinate by half the size change whatever `pan` is set to, so running it
// for every late arrival during load walks the neutral world view off its mark
// (#218) -- 0.14 degrees with pan on, 13 with it off, measured. A user-driven
// resize is a different case: it already re-runs invalidateSize today, and
// holding the visible content still across it is the wanted behaviour. What
// #map loses by staying put is a few stale pixels behind the bar, which paints
// above it. What #rx-log lost was every click on that control.
const publishBarHeight = () => {
  document.documentElement.style.setProperty('--ch-bar-h', `${bar.offsetHeight}px`)
  // The ticker hangs below the bar and is placed in pixels (#424), so it has to
  // follow the bar the same way #map does. The bar keeps growing after load --
  // chips render, the role notice arrives, the version lands -- so a single
  // measurement at init puts the ticker above the bar's final edge (#386).
  if (window.__reflowTicker) window.__reflowTicker()
}
publishBarHeight()
new ResizeObserver(publishBarHeight).observe(bar)

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
// The viewport, as the API reads it: the bbox and Leaflet's zoom number, which
// the server's hex binning grew up with (mapmodel.js, leafletZoom).
function viewportParams() {
  const b = wm.getBounds()
  return { bbox: [b.south, b.west, b.north, b.east].join(','), z: String(leafletZoom(wm.getZoom())) }
}
function qs() {
  const p = new URLSearchParams(viewportParams())
  const f = (window.currentFilters && window.currentFilters()) || {}
  for (const [k, v] of Object.entries(f)) {
    // senderPairs is already [key, value][] and may repeat a key (#223), so it
    // appends rather than sets -- URLSearchParams.set would keep only the last.
    if (k === 'senderPairs' || k === 'ignorePairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
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
// The status line and its tooltip move together: the line has room for a date
// and not for the mechanism behind it, so a truncated answer explains itself on
// hover rather than in eight words (#440).
// The two caps, named so the tooltip can state the number it is explaining
// rather than repeating a literal. HEATMAP_CAP mirrors heatmapCap in
// httpapi/api.go: the server owns it, this only reports it, and a drift shows
// up as a wrong number in a sentence rather than as broken behaviour.
const POINTS_CAP = 25000
const HEATMAP_CAP = 50000

const setStatus = (text, title = '') => {
  const el = document.getElementById('status')
  el.textContent = text
  if (title) el.title = title; else el.removeAttribute('title')
}
// What the status line says about the ignore-list (#494). It goes here rather
// than on a pill or the settings dot: #bar has no room for another control
// (#495 measured what a label costs there), and a count says more than a dot
// does. Both layers carry it, since ignoring drops rows from both.
const ignoreSuffix = () => (ignored.size ? ` · ${ignored.size} ignored` : '')

// What the click on a point opens. Same content as the Leaflet popup had;
// the Locate and Ignore buttons are handled by the delegated document
// listeners further down, so nothing here needs a reference to the popup.
let currentPoints = []
function pointPopupHtml(pt) {
  const role = pt.sender_role ? ` · ${esc(pt.sender_role)}` : ''
  const sid = pt.sender_id || ''
  const idLine = sid ? `<br><span class="pp-id">${esc(sid)}</span>` : ''
  const locBtn = (sid && canSeeLocate(currentRole)) ? `<br><button class="lc-locate" data-sender="${esc(sid)}">Locate this sender</button>` : ''
  // Ignoring is per person and needs no role: it only ever removes rows from
  // the asker's own view. Same wording as the app's popup (huntmap.js).
  const ignBtn = sid ? `<br><button class="pp-ignore" data-sender="${esc(sid)}">Ignore this ID</button>` : ''
  return `RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(senderName(pt))}${role}${idLine}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || packetTypeLabel(pt.packet_type))}<br>${esc(pt.rx_at)}${locBtn}${ignBtn}`
}
// Reception ticker two-way sync (#224): clicking a point scrolls the ticker
// to the matching line, keyed by receptionKey since /api/points rows carry no
// stable id.
wm.onLayerClick('points', (props) => {
  const pt = currentPoints[props.i]
  if (!pt) return
  wm.openPopup([pt.lon, pt.lat], pointPopupHtml(pt))
  if (rxTicker) rxTicker.focusRecord(receptionKey(pt))
})

async function drawPoints() {
  const isCurrent = pointsDraw()
  let points, capped
  try {
    ({ points, capped } = await fetchPointsPaged(qs(), { maxTotal: POINTS_CAP }))
  } catch (_) {
    // The layer is no longer cleared up front, so a failed fetch would
    // otherwise leave the previous bbox's points and count sitting there as
    // if they were the answer.
    if (mayPaint(isCurrent)) { currentPoints = []; wm.setData('points', null); setStatus('points unavailable') }
    return
  }
  if (!mayPaint(isCurrent)) return
  const unresolved = new Set()
  for (const pt of points) {
    if (!pt.sender_label && isResolvableId(pt.sender_id) && cachedName(pt.sender_id) === undefined) {
      unresolved.add(pt.sender_id.toLowerCase())
    }
  }
  // One collection, swapped in whole (#317): the previous points stay up
  // until the new ones are here. The array is kept for the click handler,
  // which gets a feature index back rather than a marker object.
  currentPoints = points
  wm.setData('points', pointFeatures(points, tierColor))
  // Same rule for the points layer. Its cap is the client's own maxTotal and the
  // rows carry rx_at, so the date comes from the data already in hand rather
  // than from a second server field.
  const cover = { truncated: capped, coversFrom: oldestRxAt(points) }
  setStatus(coverageLabel(points.length, 'points', cover) + ignoreSuffix(), coverageTitle(POINTS_CAP, cover))
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
let currentHexRings = []
// The hunter count is omitted rather than shown as 0 when the server
// withholds it (#440): a degraded caller gets no identities at all, and
// "0 hunters" over a cell with receptions in it reads as a bug.
wm.hoverText('hex', (p) => `best RSSI ${p.best} · ${p.count} pts` + (p.hunters != null ? ` · ${p.hunters} hunters` : ''))
// Ticker sync from hex mode (#224). The point-click path only exists in
// 'points'/'both', and the cold default is 'hex' (#141), so without this a
// first-time visitor clicking the map got nothing. newestInRing returns null
// when the ticker holds none of the cell's rows (ordinary — it caps at CAP
// recent rows), and then the ticker is left as it is.
wm.onLayerClick('hex', (props) => {
  if (!rxTicker) return
  const ring = currentHexRings[props.i]
  if (!ring) return
  const hit = newestInRing(rxTicker.records(), ring)
  if (hit) rxTicker.focusRecord(receptionKey(hit))
})

async function drawHex() {
  const isCurrent = hexDraw()
  let fc
  try {
    const r = await fetch(`${API_BASE}/api/heatmap?${qs()}`)
    if (!r.ok) throw new Error(`heatmap ${r.status}`)
    fc = await r.json()
  } catch (_) {
    if (mayPaint(isCurrent)) { currentHexRings = []; wm.setData('hex', null); setStatus('heatmap unavailable') }
    return
  }
  if (!mayPaint(isCurrent)) return
  // The rings are kept for the click handler: a cell is an aggregate with no
  // reception of its own, so a click matches it against the ticker's rows.
  currentHexRings = (fc.features || []).map((f) => f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]))
  wm.setData('hex', hexFeatures(fc.features, tierColor))
  // "cells (capped)" under a range button reading All time is a contradiction a
  // reader cannot resolve. The truncation is the most RECENT n receptions, so
  // the honest report is the date it reaches back to (#440).
  const cover = { truncated: fc.truncated, coversFrom: fc.covers_from }
  setStatus(coverageLabel(fc.features.length, 'cells', cover) + ignoreSuffix(), coverageTitle(HEATMAP_CAP, cover))
}

// The point layer, gated like Locate below (#493). Below member /api/points
// returns 24 h and 500 rows, which read as a thin or empty layer with nothing
// on the control saying why. The Points and Both segments stay visible and
// disabled rather than hidden: a visitor should be able to see that the layer
// exists and what it takes to open it, which is also what the map has to sell.
// The reason renders as a line under the group (#layer-gate-note), because on
// a phone a tooltip is nothing at all.
//
// ?mode=points is restored before the role is known, so the mode is re-derived
// here rather than only at module-eval time, the same deferral ?locate=1 uses.
function applyPointLayerGate() {
  const can = canSeePointLayer(currentRole)
  const reason = pointLayerReason(currentRole)
  for (const b of document.querySelectorAll('#layer-seg button')) {
    if (b.dataset.mode === 'hex') continue // hex is everyone's layer
    b.disabled = !can
    // The note below carries the reason visually; this hands it to a reader
    // landing on the disabled segment.
    if (reason) b.setAttribute('aria-describedby', 'layer-gate-note')
    else b.removeAttribute('aria-describedby')
  }
  const note = document.getElementById('layer-gate-note')
  note.textContent = reason || ''
  note.hidden = !reason
  const gated = modeForRole(mode, currentRole)
  if (gated !== mode) {
    mode = gated
    syncLayerSeg()
    urlstate.save()
  }
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
    // Read before clearing: ?nodepos=1 binds the checkbox even for a guest,
    // whose control is hidden, and that ask is the only thing separating "you
    // cannot see this layer" from a line about a layer nobody wanted.
    const asked = nodePosCb.checked
    nodePosCb.checked = false
    clearNodePosLayer(); nodePosSig = null
    showNodePosNotice({ on: asked, member: false })
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

// announceRoleRise says, once, that the wait ended (#530). Called from
// applyRole, so it covers every path that learns a role: first load, a login,
// and the focus re-check below.
function announceRoleRise(role) {
  const el = document.getElementById('role-notice')
  if (!el) return
  const seen = loadSeenRole()
  saveSeenRole(role)
  if (!roleRose(seen, role)) return
  const text = roleNotice(role)
  if (!text) return
  document.getElementById('role-notice-text').textContent = text
  el.hidden = false
}

function applyRole(me) {
  currentRole = me.role || 'guest'
  announceRoleRise(currentRole)
  const notice = document.getElementById('guest-notice')
  const msg = guestNotice(currentRole)
  notice.textContent = msg || ''
  notice.title = msg ? 'Guests & hunters see: last 24 h, max 500 recent points, ~1 km positions, anonymised hunters. Members see full data.' : ''
  notice.hidden = !msg
  // The 2/7/30-day rows are no longer hidden below member (#492). They were,
  // because /api/points clamps those roles to 24 h and a label reading "Last 7
  // days" over 24 h of data is a lie (#300). What changed is which layer the
  // note belongs on: the hex the map opens on is not windowed at all since
  // #466, so hiding the rows also hid the ranges that layer CAN show. The note
  // now names the point layer instead (rangeLabelFor), and only while it is on.
  //
  // An empty range is not a state below member either: "all time" is the one
  // promise /api/heatmap's 50 000-row cap cannot keep, so a shared link with
  // no range lands on the same 30 days a cold start does.
  // The same rule for the one path applyRange cannot see: the role changing
  // under a range that is already applied, i.e. a member with an empty range
  // logging out. Not covered by e2e; applyRange's branch is.
  const { from: rFrom, to: rTo } = rangeForRole(fFrom.value, fTo.value, { degraded: isDegradedFor(currentRole) })
  if (rFrom !== fFrom.value || rTo !== fTo.value) {
    fFrom.value = rFrom; fTo.value = rTo
    urlstate.save()
    updateTimeRangeTimer()
  }
  applyLocateGate()
  applyObserverGate()
  applyPointLayerGate()
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
    if (mode === 'points' || mode === 'both') drawPoints(); else { pointsDraw(); currentPoints = []; wm.setData('points', null) }
    if (mode === 'hex' || mode === 'both') drawHex(); else { hexDraw(); currentHexRings = []; wm.setData('hex', null) }
    // Picker works in all modes, not just points mode (#288 blocker 1)
    refreshPickerCandidates()
    refreshHunterPickerCandidates()
    drawNodePositions()   // follows the same filter/bbox set as the points
    if (rxTicker) rxTicker.refetch() // same trigger points as the map (#224)
  }, 250)
}

for (const segBtn of document.querySelectorAll('#layer-seg button')) {
  segBtn.addEventListener('click', () => {
    if (segBtn.dataset.mode === mode) return
    mode = segBtn.dataset.mode
    syncLayerSeg()
    urlstate.save()
    refresh()
  })
}
const themeBtn = document.getElementById('theme-toggle')
// The moon/sun SVGs swap on data-theme via CSS (#539: no emoji as icons).
const syncThemeBtn = () => {}
syncThemeBtn()
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  wm.setTheme(theme)
  syncThemeBtn()
  urlstate.save()
  refresh() // redraw markers/polygons so they pick up the new --ch-sig-* colors
})

// One event: MapLibre's moveend follows a zoom as well as a pan.
wm.on('moveend', () => { urlstate.save(); refresh() })
window.__refresh = refresh
window.__mapZoom = () => leafletZoom(wm.getZoom()) // test hook, in the URL's (Leaflet) zoom units
window.__mapCenter = () => wm.getCenter() // test hook
window.__mapProject = (lat, lon) => wm.project(lat, lon) // test hook
// Canvas layers have no DOM to count; the tests read the sources instead.
window.__featureCount = (id) => wm.featureCount(id) // test hook
window.__locateHeat = () => wm.heatImage() // test hook

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
    if (k === 'senderPairs' || k === 'ignorePairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
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
// enrichNames fills sender_label in place from the resolver cache, mirroring
// app.js's function of the same name. The picker reads sender_label and
// nothing else, so without this every relay row read "(name not resolved)"
// while the very same node showed its name in a point popup, which resolves
// through senderName(). Returns the ids that still need a lookup.
function enrichNames(rows) {
  const misses = new Set()
  for (const r of rows) {
    const key = resolvableKey(r)
    if (!key) continue
    const hit = cachedName(key)
    if (hit === undefined) misses.add(key)
    else if (hit) r.sender_label = hit
  }
  return misses
}

// renderPickerRows enriches, renders, and re-renders once the outstanding
// lookups land. It terminates: the second pass finds every key in the cache,
// including the ones that resolved to '' (ambiguous or unknown), so it has no
// misses of its own.
function renderPickerRows(points) {
  const misses = enrichNames(points)
  targetPicker.render(points, Date.now())
  if (!misses.size) return
  Promise.all([...misses].map((k) => resolveName(k))).then((names) => {
    if (names.some((n) => n)) nameRedraw.run('picker', () => renderPickerRows(points))
  })
}

let cachedCandidatePoints = []
let cachedCandidatureSig = null
async function refreshPickerCandidates() {
  if (!targetPicker || !senderPicker || senderPicker.hidden) return
  const p = new URLSearchParams(viewportParams())
  // The candidate pool is sender-independent by construction, so both the
  // signature and the query drop the sender filters (#288 blocker 4) — see
  // withoutSenderFilters. Keeping them would shrink the list you are picking
  // from as you pick, and refetch 25k rows on every checkbox click.
  const f = withoutSenderFilters((window.currentFilters && window.currentFilters()) || {})
  const sig = [...Object.entries(f).map(([k, v]) => `${k}=${v}`), `bbox=${p.get('bbox')}`, `z=${p.get('z')}`].sort().join('&')
  if (sig === cachedCandidatureSig) {
    // Filter unchanged, just re-render with current selection state
    renderPickerRows(cachedCandidatePoints)
    return
  }
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  try {
    const { points } = await fetchPointsPaged(p.toString(), { maxTotal: 25000 })
    cachedCandidatePoints = points
    cachedCandidatureSig = sig
    renderPickerRows(points)
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
  const p = new URLSearchParams(viewportParams())
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
    if (k === 'senderPairs' || k === 'ignorePairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
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
    if (k === 'senderPairs' || k === 'ignorePairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  p.set('limit', String(RX_CAP)); p.set('offset', '0')
  const r = await fetch(`${API_BASE}/api/points?${p.toString()}`)
  if (!r.ok) throw new Error(`points ${r.status}`)
  const d = await r.json()
  return d.points || []
}

// Snap the map to the selected hunter(s) (#195).
async function snapToHunter() {
  const n = (window.currentHunters ? window.currentHunters() : '').split(',').filter(Boolean).length
  if (n === 0) {
    // "All hunters": drop the marker, no forced viewport change.
    wm.clearMarkers('hunter')
    return
  }
  let fetched
  try {
    fetched = await fetchPointsPaged(filtersQs(), { maxTotal: 25000 })
  } catch (_) { return }
  wm.clearMarkers('hunter')
  const points = fetched.points
  if (!points.length) return
  wm.fitBounds(latLonBounds(points.map((p) => [p.lat, p.lon])))
  if (n === 1) {
    // Newest-first (server default order, #142) -> points[0] is the latest
    // reception. This is the hunter phone's own GPS, not a target position.
    const latest = points[0]
    const el = document.createElement('div')
    el.className = 'hunter-pin'
    el.title = `${latest.hunter_name} · hunter's own GPS (not a target position)`
    wm.addMarker('hunter', el, [latest.lat, latest.lon], { anchor: 'bottom',
      popupHtml: `${esc(latest.hunter_name)} · hunter's own GPS (not a target position)` })
  }
  // #196 pairing decision: >1 hunter selected -> fit to the union, no marker.
}
// Fired from the hunter picker's onChange (#290) -- wired further down, once
// the picker exists, same reasoning as the sender picker's onChange.
window.__hunterMarkerLatLng = () => wm.markerLatLng('hunter') // test hook

// Fit the map to today's actual points on first load when there's no
// saved/URL view yet (#218) -- same fetch-and-fitBounds shape as
// snapToHunter() above, fired once instead of on a filter change. Leaves the
// neutral world-view placeholder in place if there's no data to fit to yet.
async function snapToLatestPoints() {
  let fetched
  try {
    fetched = await fetchPointsPaged(filtersQs(), { maxTotal: 25000 })
  } catch (_) { return }
  if (fetched.points.length) wm.fitBounds(latLonBounds(fetched.points.map((p) => [p.lat, p.lon])))
}
window.__snapToLatestPoints = snapToLatestPoints // test hook

// Paint a normalized density grid to a canvas; the map draws it as an image
// source over the cell's bounds (mapmodel.js builds the bytes).
function heatmapImage(hm) {
  const { grid, rows, cols, bounds } = hm
  const canvas = document.createElement('canvas')
  canvas.width = cols; canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  img.data.set(heatImageData(grid, rows, cols, heatStops()))
  ctx.putImageData(img, 0, 0)
  return { url: canvas.toDataURL(), coordinates: imageCoordinates(bounds) }
}

function clearLocateLayer() {
  wm.setHeat(null)
  wm.setData('locate-in', null); wm.setData('locate-out', null)
  wm.clearMarkers('locate')
}

// Render a full locate result onto the locate sources + the info card.
function renderLocate(points, senderId) {
  if (!locateActive) return
  clearLocateLayer()
  const res = locate(points)
  if (res.heatmap) wm.setHeat(heatmapImage(res.heatmap))
  // observation points: inliers coloured by RSSI, outliers greyed
  const { inliers, outliers } = locateFeatures(res, tierColor, cssVar('--ch-sig-none'))
  wm.setData('locate-in', inliers); wm.setData('locate-out', outliers)
  if (res.centroid) {
    const el = document.createElement('div'); el.className = 'lc-centroid'; el.title = 'weighted estimate'
    wm.addMarker('locate', el, [res.centroid.lat, res.centroid.lon])
  }
  // strongest reception: where you heard it loudest (closest single sample)
  if (res.strongest) {
    const el = document.createElement('div'); el.className = 'lc-strongest'; el.textContent = '★'
    el.title = `strongest reception ${res.strongest.rssi} dBm`
    wm.addMarker('locate', el, [res.strongest.lat, res.strongest.lon])
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
  currentPoints = []; currentHexRings = []
  wm.setData('points', null); wm.setData('hex', null); wm.setData(csAdvertLayer, null); wm.setData(csRelayLayer, null)
  clearNodePosLayer(); nodePosSig = null
  setRxHighlight(null) // suppress ticker rings in focus mode (#287 blocker 3)
  urlstate.save()
  drawLocate()
  locateTimer = setInterval(drawLocate, 5000)
}
function deactivateLocate() {
  locateActive = false
  locateBtn.classList.remove('on')
  clearInterval(locateTimer); locateTimer = null
  clearLocateLayer()
  document.getElementById('locate-info').hidden = true
  urlstate.save()
  refresh() // restore points/hex per mode
  if (csAdvertCb.checked) drawObserverPoints('advert', csAdvertLayer, false)
  if (csRelayCb.checked) drawObserverPoints('rxlog', csRelayLayer, true)
}
locateBtn.addEventListener('click', () => (locateActive ? deactivateLocate() : activateLocate()))

// "Locate this sender" button inside a popup: pick the clicked node in the
// target picker (an exact id, not a prefix, #498) and start or refresh a
// Locate for it. The pick is what locateSender reads, so Locate follows.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.lc-locate')
  if (!btn) return
  wm.closePopup()
  if (targetPicker) {
    targetPicker.setSelected([String(btn.dataset.sender).toLowerCase()])
    syncTargetToggleLabel()
    urlstate.save()
  }
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

// The points behind each CoreScope layer, for the click handler.
const observerPoints = { advert: [], rxlog: [] }
function observerPopupHtml(pt, ring) {
  const id = (pt.heard_key || '').toLowerCase()
  const name = (isResolvableId(id) && cachedName(id)) || id || '—'
  const hk = pt.heard_key || ''
  const idLine = hk ? `<br><span class="pp-id">${esc(hk)}</span>` : ''
  const locBtn = (hk && canSeeLocate(currentRole)) ? `<br><button class="lc-locate" data-sender="${esc(hk)}">Locate this sender</button>` : ''
  // Glossary (#174): 'observer' -> 'hunter' (our own term for the capturer);
  // 'relay'/'node' left as-is, tied to the CS-relays/CS-adverts toggle wording
  // (CoreScope's own source distinction, not our sender/repeater glossary).
  return `RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>${ring ? 'relay' : 'node'} ${esc(name)}${idLine}<br>hunter ${esc(pt.observer)}<br>${esc(pt.rx_at)}${locBtn}`
}
for (const [src, ring] of [['advert', false], ['rxlog', true]]) {
  wm.onLayerClick(`observer-${src}`, (props) => {
    const pt = observerPoints[src][props.i]
    if (pt) wm.openPopup([pt.lon, pt.lat], observerPopupHtml(pt, ring))
  })
}

async function drawObserverPoints(src, layer, ring) {
  if (!canSeeObserverPoints(currentRole)) return
  const isCurrent = observerDraw[src]()
  observerPoints[src] = []; wm.setData(layer, null)
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
  if (!csCbForSrc(src).checked || locateActive) { observerPoints[src] = []; wm.setData(layer, null); return }
  // Two draws of the same layer can overlap — a held redraw released by a
  // popupclose while an explicit one (filter change, checkbox) is mid-fetch.
  // The layer is cleared before the fetch, so both responses would append and
  // the layer would end up with every marker twice.
  if (!isCurrent()) return
  const unresolved = new Set()
  for (const pt of d.points || []) {
    const id = (pt.heard_key || '').toLowerCase()
    if (isResolvableId(id) && cachedName(id) === undefined) unresolved.add(id)
  }
  observerPoints[src] = d.points || []
  wm.setData(layer, observerFeatures(observerPoints[src], ring, tierColor))
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
//
// The status rides along (#376). The server answers 403 below member and three
// distinct 503s — not configured, reachable but empty, unreachable — because
// they are three different things to a reader of the map, and a plain null here
// would have flattened them back into one silent empty layer.
async function fetchNodeRegistry() {
  const bbox = viewportParams().bbox
  try {
    const r = await fetch(`${API_BASE}/api/nodes/positions?bbox=${encodeURIComponent(bbox)}`, { credentials: 'same-origin' })
    const body = await r.json().catch(() => ({}))
    const status = registryStatusFor(r.status, body && body.error)
    if (status !== 'ok') return { status, nodes: [], stale: false }
    return { status, nodes: body.nodes || [], stale: Boolean(body.stale), truncated: Boolean(body.truncated) }
  } catch (_) {
    return null
  }
}

// Both surfaces, from one decision (nodeposnotice.js). Called on every exit
// path of a draw, including the early ones: a layer that returns without
// saying why is the whole of #376.
// `on` defaults to the checkbox, but the role branch passes it explicitly: it
// clears the checkbox before it can explain itself, and "the account is why"
// is precisely what a guest who deep-linked ?nodepos=1 needs to be told.
// Narrow enough that the disclaimer block is a quarter of the map (#426).
// matchMedia rather than innerWidth so the answer arrives as an event: the
// value is read at render time, so re-answering by itself changes nothing —
// a phone turned to landscape would keep the phone's verdict until something
// else happened to redraw, which on a still map is never. The listener below
// is what makes the query worth using.
const narrowQuery = window.matchMedia('(max-width: 640px)')
const narrowScreen = () => narrowQuery.matches

// Cleared on every entry, so rapid toggling cannot have a stale timer hide the
// prose two seconds into a later activation.
let nodePosGlanceTimer = null
let nodePosGlanceOver = false
// The arguments the last real caller passed, or null before there has been one.
// A re-render has to use THESE and not the defaults: `registry: null` means
// "unreachable" to nodePosPresentation, so a bare re-render would replace a
// working layer's key with an error line.
let nodePosNoticeArgs = null

// Re-render the notice from what was last drawn, for the two things that change
// the verdict without changing the layer: the glance expiring, and the screen
// crossing the narrow boundary. Silent before the first real render — there is
// nothing to re-state, and stating the defaults would be a lie.
function rerenderNodePosNotice() {
  if (nodePosNoticeArgs) showNodePosNotice(nodePosNoticeArgs)
}

// A rotation crosses the boundary in both directions: to landscape, the prose
// is affordable again and comes back; to portrait, an already-expired glance
// takes it away. Neither redraws the layer, so nothing else would notice.
narrowQuery.addEventListener('change', rerenderNodePosNotice)

// Whether a glance has been started for the current activation of the layer.
// Needed because `change` is not the only way the layer comes on:
// urlstate.bindControl restores the checkbox by assignment and dispatches
// nothing (urlstate.js `set:`), so ?nodepos=1 and the localStorage-restored
// state both arrive with no event at all. Started from the change listener
// alone, those readers never began a glance, nodePosGlanceOver stayed false,
// and the note was permanent for the rest of the session — and since urlstate
// persists to `ch-state`, that is every returning phone user who had the layer
// on last time, i.e. exactly the case #426 is about.
let nodePosGlanceStarted = false

// Restarts the glance. Called when the layer is switched on, so that off-and-on
// is a fresh glance rather than a memory of the last one.
function restartNodePosGlance() {
  if (nodePosGlanceTimer) { clearTimeout(nodePosGlanceTimer); nodePosGlanceTimer = null }
  nodePosGlanceOver = false
  nodePosGlanceStarted = false
  if (!nodePosCb.checked) return
  nodePosGlanceStarted = true
  nodePosGlanceTimer = setTimeout(() => {
    nodePosGlanceTimer = null
    nodePosGlanceOver = true
    rerenderNodePosNotice()
  }, NODEPOS_GLANCE_MS)
}

// Starts the glance for a layer that came on without a change event. Once per
// activation: a later draw — a pan, a zoom, a refresh tick — must not push the
// note back on screen after it has gone, and must not restart the clock.
function ensureNodePosGlance() {
  if (!nodePosCb.checked || nodePosGlanceStarted) return
  restartNodePosGlance()
}

function showNodePosNotice({ on = nodePosCb.checked, member = true, registry = null, drawn = 0 } = {}) {
  nodePosNoticeArgs = { on, member, registry, drawn }
  const { note, key } = nodePosPresentation({
    on, member, registry, drawn, narrow: narrowScreen(), glanceExpired: nodePosGlanceOver,
  })
  const noteEl = document.getElementById('nodepos-note')
  const keyEl = document.getElementById('nodepos-key')
  if (noteEl) noteEl.hidden = !note
  if (keyEl) {
    keyEl.hidden = !key
    keyEl.textContent = key
  }
}

// One probe span for the page, created on the first draw that needs it: the map
// container exists by then, and a layer that is never switched on never touches
// the DOM. Kept across draws so the width cache survives panning and zooming,
// which is where the saving is (#425).
let nodeLabelMeasure = null
function labelMeasurer() {
  if (!nodeLabelMeasure) nodeLabelMeasure = createLabelMeasurer(wm.getContainer())
  return nodeLabelMeasure
}

async function drawNodePositions() {
  const gen = ++nodePosGen
  // locateActive for the same reason drawObserverPoints() checks it: Locate is a
  // focus view and it suppresses refresh() for the whole session, so anything
  // that repaints into it stays there until Locate is switched off.
  // activateLocate() clears the layer without bumping nodePosGen or unchecking
  // the box, so without this guard a draw that lands a moment later walks
  // through every other one (#390). The re-entry that originally produced it —
  // this function calling itself when its /api/resolve calls settled — is gone
  // with #377; the fetch below is the window that remains.
  if (!nodePosCb.checked || !canSeeObserverPoints(currentRole) || locateActive) {
    clearNodePosLayer(); nodePosSig = null
    // A guest can still reach this with ?nodepos=1, since urlstate binds the
    // checkbox whether or not the control is on screen — and that is state 1
    // of #376: an empty layer whose cause is the account, not the area.
    showNodePosNotice({ member: canSeeObserverPoints(currentRole) })
    return
  }
  // Past the guards, so this is a draw that really puts the layer up. A guest
  // deep-linking ?nodepos=1 returns above and keeps its note: "the account is
  // why" is the only explanation on screen, and timing it out would leave an
  // empty layer with nothing saying so.
  ensureNodePosGlance()
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
  // A newer draw started, the layer was switched off, or Locate took over
  // while we were waiting (#390). The await is shorter than it was — the
  // resolve fan-out this layer used for positions is gone — but the
  // registry/points fetch above is still a window Locate can start during,
  // and Locate suppresses refresh() for the whole session, so anything that
  // repaints into it stays until Locate is switched off.
  if (gen !== nodePosGen || !nodePosCb.checked || locateActive) return
  if (!registry || registry.status !== 'ok') {
    // Leave the last good layer up — a transient failure should not wipe
    // markers that are still the best thing we know — but say so, because
    // markers under no explanation read as a working, current layer.
    showNodePosNotice({ registry })
    return
  }
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

  // Before the signature short-circuit: `deduped` is what this draw would put
  // on screen, and the notice must follow it even when the markers themselves
  // are unchanged — a registry that went stale, or emptied, between two
  // identical draws still changes what the layer may claim.
  showNodePosNotice({ registry, drawn: deduped.length })

  // Which names fit without printing over each other (#425). Sorted by id
  // rather than by anything positional: the order decides which of two
  // colliding names survives, and a positional order would reshuffle the
  // winners on every pan, so labels would flicker in and out around the edges.
  //
  // The raw name, not the escaped one: entities inflate what is measured, and
  // the measured width is what decides overlap.
  const rawLabel = (d) => String(d.name || cachedName(d.id) || d.id.slice(0, 6))
  const labelled = new Set(unclutteredLabels(
    [...deduped]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((d) => {
        const pt = wm.project(d.advertised.lat, d.advertised.lon)
        return { id: d.id, x: pt.x, y: pt.y, label: rawLabel(d) }
      }),
    { measure: labelMeasurer() },
  ))

  const sig = deduped.map((d) => [d.id, d.name, d.p.kind, Math.round(d.p.driftM ?? -1),
    Math.round(d.p.circle ? d.p.circle.radiusM : -1),
    d.est ? `${d.est.centroid.lat.toFixed(5)},${d.est.centroid.lon.toFixed(5)}` : ''].join(':')).join('|')
    // The label set is part of what is drawn, and it depends on the projection
    // rather than on the rows: a zoom that changes nothing about which nodes
    // are in view still changes which names fit. Without it in the signature,
    // the early return below would leave the previous zoom's labels on screen.
    + '#' + [...labelled].join(',')
  if (sig === nodePosSig) return   // nothing changed — leave the layer (and any open popup) alone
  nodePosSig = sig
  clearNodePosLayer()

  const lines = [], circles = []
  for (const { id, advertised, est, p, name } of deduped) {
    const color = cssVar(driftColorVar(p))
    const html = nodePosPopup(name, id, p, est)
    // The name rides on the map next to the ▲, not just in the popup: the
    // layer is opt-in, so it can afford the labels while it is on. Only the ▲
    // is labelled — the ● is the same node.
    // Only the names that survived decluttering are drawn; the ▲ always is, and
    // the name is still in the popup, so nothing becomes unreachable (#425).
    const label = labelled.has(id) ? `<span class="np-label">${esc(rawLabel({ id, name }))}</span>` : ''
    const adv = document.createElement('div')
    adv.className = 'np-advert'; adv.style.color = color; adv.innerHTML = `▲${label}`
    wm.addMarker('nodepos', adv, [advertised.lat, advertised.lon], { popupHtml: html })
    if (!est || !est.centroid) continue
    const estEl = document.createElement('div')
    estEl.className = 'np-estimate'; estEl.style.background = color
    wm.addMarker('nodepos', estEl, [est.centroid.lat, est.centroid.lon], { popupHtml: html })
    lines.push({ type: 'Feature', properties: { color },
      geometry: { type: 'LineString', coordinates: [[advertised.lon, advertised.lat], [est.centroid.lon, est.centroid.lat]] } })
    if (p.circle) {
      const ring = circleRing(est.centroid, p.circle.radiusM)
      if (ring.length) circles.push({ type: 'Feature', properties: { color, style: p.circle.kind }, geometry: { type: 'LineString', coordinates: ring } })
    }
  }
  wm.setData('nodedrift', { type: 'FeatureCollection', features: lines })
  wm.setData('nodecircle', { type: 'FeatureCollection', features: circles })
}

// The layer is three things: the two GeoJSON sources and the markers.
function clearNodePosLayer() {
  wm.setData('nodedrift', null); wm.setData('nodecircle', null)
  wm.clearMarkers('nodepos')
}

nodePosCb.addEventListener('change', () => { restartNodePosGlance(); drawNodePositions() })

const csAdvertCb = document.getElementById('cs-adverts')
const csRelayCb = document.getElementById('cs-relays')
const csCbForSrc = (src) => (src === 'advert' ? csAdvertCb : csRelayCb)
// Drops both CS observer layers and resets their checkboxes — used when the
// gate hides the toggle so a later role change doesn't reveal a stale-checked
// control with a cleared layer.
function clearObserverLayers() {
  observerPoints.advert = []; observerPoints.rxlog = []
  wm.setData(csAdvertLayer, null); wm.setData(csRelayLayer, null)
  csAdvertCb.checked = false; csRelayCb.checked = false
}
function toggleCsLayer(cb, src, layer, ring) {
  if (locateActive) { drawLocate(); return } // focus mode: feed Locate, not the all-nodes layer
  if (cb.checked) drawObserverPoints(src, layer, ring); else { observerPoints[src] = []; wm.setData(layer, null) }
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
  trLabelEl.textContent = rangeLabelFor(fFrom.value, fTo.value, now, { degraded: isDegradedFor(currentRole) })
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
  // "Still includes now", not "is written as a token". Since the cold-start
  // default became All time (#440) the old test was false for the commonest
  // range on the map, so the timer was never created and nothing refreshed --
  // a hunter watching a live drive saw the page as it loaded and no further
  // (2026-08-24). A range that ends in the past keeps its timer off: nothing
  // new can fall inside it.
  const isRelative = rangeIsLive(fFrom.value, fTo.value)
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
  // Below member an empty range is not a state (#492): clearing both fields
  // asks for all time, which is the one promise /api/heatmap's 50 000-row cap
  // cannot keep, so it lands on the cold-start window instead.
  const r = rangeForRole(from, to, { degraded: isDegradedFor(currentRole) })
  fFrom.value = r.from; fTo.value = r.to
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
// Placed after unhiding, and right-aligned by preference: the panel is ~400px
// of two columns, so on a wide bar it grows leftwards from the toggle. It flips
// or shifts when that runs off a narrow screen (#372) — the old CSS `right: 0`
// could not, and put the whole panel off the left edge of a phone.
function openTimePicker() {
  syncTimeUi()
  trPanel.hidden = false
  trToggle.setAttribute('aria-expanded', 'true')
  placePopover(trToggle, trPanel, { align: 'right' })
}
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
// A resize rewraps #bar and moves the toggle, so an open panel has to follow.
window.addEventListener('resize', () => {
  if (!trPanel.hidden) placePopover(trToggle, trPanel, { align: 'right' })
})
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
  syncTargetToggleLabel()
  syncHunterToggleLabel()
  clearObserverLayers()
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
  set: (v) => { if (v === 'light' || v === 'dark') { theme = v; document.documentElement.setAttribute('data-theme', theme); wm.setTheme(theme); syncThemeBtn() } } })
urlstate.register({ key: 'mode', get: () => mode,
  set: (v) => { if (MODES.includes(v)) { mode = v; syncLayerSeg() } } })
// Map view: applied synchronously at construction (top of file); here we only
// need the getters so pan/zoom lands in the URL and storage.
urlstate.register({ key: 'lat', get: () => wm.getCenter().lat.toFixed(5), set: () => {} })
urlstate.register({ key: 'lon', get: () => wm.getCenter().lng.toFixed(5), set: () => {} })
// Leaflet's number, so every shared link keeps its meaning (mapmodel.js).
urlstate.register({ key: 'z', get: () => String(leafletZoom(wm.getZoom())), set: () => {} })
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
urlstate.bindControl('unnamed', 'f-unnamed', { checkbox: true })

// Ticker placement, drag and fold (#424).
//
// Dragging replaces the anchor rather than overriding it, so there is no "put
// it back" button and the clamp is the safety net: on load and on every resize
// the box is pulled inside the viewport, or a ticker left at the edge of a wide
// monitor would be unreachable on a laptop.
const rxLog = document.getElementById('rx-log')
if (rxLog) {
  const NARROW = window.matchMedia('(max-width: 640px)')
  let place = { x: 0, y: 0, collapsed: false }

  // The bar's lower edge, which is the ticker's ceiling: the bar is opaque, so
  // anything above it is simply hidden. --ch-bar-h is republished on every bar
  // resize (#386), so this follows a wrapped or taller bar for free.
  const barBottom = () => (document.getElementById('bar')?.getBoundingClientRect().bottom ?? 0) + 4
  const size = () => ({ w: rxLog.offsetWidth, h: rxLog.offsetHeight })
  const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight, top: barBottom() })

  function apply() {
    rxLog.style.setProperty('--rx-x', `${place.x}px`)
    rxLog.style.setProperty('--rx-y', `${place.y}px`)
    rxLog.classList.toggle('rx-folded', place.collapsed)
    const fold = rxLog.querySelector('.rx-fold')
    if (fold) {
      fold.setAttribute('aria-expanded', String(!place.collapsed))
      fold.setAttribute('aria-label', place.collapsed ? 'Show the receptions ticker' : 'Hide the receptions ticker')
    }
    // The left grab strip spans the visible height, which changes when the
    // list folds away.
    rxLog.style.setProperty('--rx-grab-h', `${Math.max(24, rxLog.offsetHeight)}px`)
  }

  function reflow() {
    place = { ...place, ...clampToViewport(place, size(), viewport()) }
    apply()
  }

  urlstate.register({
    key: 'rx',
    get: () => serialise(place),
    set: (v) => {
      const saved = parsePlacement(v)
      place = initialPlacement({ saved, size: size(), viewport: viewport(), narrow: NARROW.matches })
      apply()
    },
  })
  // urlstate only calls set() when it has a value, so a first visit needs the
  // same decision made explicitly rather than leaving the ticker at 0,0.
  place = initialPlacement({ saved: null, size: size(), viewport: viewport(), narrow: NARROW.matches })
  apply()

  window.addEventListener('resize', reflow)
  // publishBarHeight calls this on every bar resize, which is the only signal
  // for the bar growing after load without the window changing at all.
  window.__reflowTicker = reflow

  // Delegated, not bound to the elements: createReceptionTicker writes this
  // markup later than this module runs, so querySelectorAll here finds nothing
  // and the controls end up inert. #rx-log itself is static in index.html.
  rxLog.addEventListener('click', (e) => {
    if (!e.target.closest('.rx-fold')) return
    place = { ...place, collapsed: !place.collapsed }
    apply()
    reflow()          // folding changes the height, which can free or need space
    urlstate.save()
  })

  // Pointer events rather than mouse so a touch drag works on a tablet, where
  // there is no hover to reveal the frame but the strips are still there.
  rxLog.addEventListener('pointerdown', (e) => {
    const strip = e.target.closest('.rx-grab-t, .rx-grab-l')
    if (!strip) return
    e.preventDefault()
    const dx = e.clientX - place.x, dy = e.clientY - place.y
    try { strip.setPointerCapture(e.pointerId) } catch (_) { /* capture is an optimisation, not the mechanism */ }
    rxLog.classList.add('rx-dragging')
    const move = (ev) => {
      place = { ...place, ...clampToViewport({ x: ev.clientX - dx, y: ev.clientY - dy }, size(), viewport()) }
      apply()
    }
    // On window, not the strip: with capture unavailable a fast drag leaves the
    // 6px strip between two move events and the ticker stops following.
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      rxLog.classList.remove('rx-dragging')
      urlstate.save()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}

// Filters pill + panel (#423 built it for phones, #539 made it the only
// presentation). The panel opens under the bar at every width; the scrim
// under it is a body child, since #bar's backdrop-filter makes the bar the
// containing block for its own fixed descendants and a scrim inside it could
// never cover the viewport.
//
// Not wirePopover: that positions an anchored panel with placePopover and uses
// `hidden`. The dismiss semantics are copied from it deliberately -- outside
// click in the capture phase, Escape -- so the panel behaves like every other
// panel here.
const barFilters = document.getElementById('bar-filters')
const filterPill = document.getElementById('filter-pill')
if (barFilters && filterPill) {
  const scrim = document.getElementById('bf-scrim')
  const setOpen = (on) => {
    barFilters.classList.toggle('bf-open', on)
    filterPill.setAttribute('aria-expanded', String(on))
    if (scrim) scrim.hidden = !on
    // The "+N more" count is only measurable with the panel open.
    if (on) refreshFilterPill()
  }
  filterPill.addEventListener('click', () => setOpen(!barFilters.classList.contains('bf-open')))
  document.getElementById('bf-close').addEventListener('click', () => setOpen(false))
  document.addEventListener('click', (e) => {
    if (!barFilters.classList.contains('bf-open')) return
    if (e.target.closest('#bar-filters') || e.target.closest('#filter-pill')) return
    setOpen(false)
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && barFilters.classList.contains('bf-open')) setOpen(false)
  })

  // The pill carries the count the bar can no longer show: how many filter
  // dimensions are narrowed behind it, the way the hunter picker's button
  // carries its selection count. Recomputed from the DOM rather than tracked,
  // so it cannot drift from the controls it describes. The same number feeds
  // the panel header, the Clear button's label and the phone-width "+N"
  // reveal on the type chips.
  const refreshFilterPill = () => {
    const on = (id) => { const el = document.getElementById(id); return !!(el && el.checked) }
    const types = window.currentTypes ? window.currentTypes() : ''
    const typeCount = String(types || '').split(',').filter(Boolean).length
    const count = activeFilterCount({
      directOnly: on('f-direct'),
      senderUnknown: on('f-unnamed'),
      types: String(types || '').split(',').filter(Boolean),
      idClasses: String((window.currentIdClasses ? window.currentIdClasses() : '') || '').split(',').filter(Boolean),
      csAdverts: on('cs-adverts'),
      csRelays: on('cs-relays'),
      nodePos: on('f-nodepos'),
    })
    const pillCount = document.getElementById('filter-pill-count')
    pillCount.hidden = count === 0
    pillCount.textContent = count ? ` (${count})` : ''
    filterPill.classList.toggle('has-selection', count > 0)
    const headCount = document.getElementById('bf-count')
    headCount.hidden = count === 0
    headCount.textContent = count === 1 ? '1 active' : `${count} active`
    const typesCount = document.getElementById('bf-types-count')
    typesCount.hidden = typeCount === 0
    typesCount.textContent = `${typeCount} of ${document.querySelectorAll('#f-types .f-chip').length}`
    // Never disabled at 0: Clear also resets the sender/hunter picks and the
    // time range, none of which the panel's count includes.
    const clearBtn = document.getElementById('clear-filters')
    clearBtn.textContent = count > 0 ? `Clear ${count} ${count === 1 ? 'filter' : 'filters'}` : 'Clear filters'
    // Phone width hides the inactive tail of the type chips (the style.css
    // cap); the button says how many are out of sight. Measurable only while
    // the panel is open — closed, the button is out of sight anyway.
    const moreBtn = document.getElementById('bf-types-more')
    if (barFilters.classList.contains('bf-types-all')) {
      moreBtn.hidden = false
      moreBtn.textContent = 'Fewer types'
    } else {
      const hiddenChips = barFilters.classList.contains('bf-open')
        ? [...document.querySelectorAll('#f-types .f-chip')].filter((c) => c.offsetWidth === 0).length
        : 0
      moreBtn.hidden = hiddenChips === 0
      moreBtn.textContent = hiddenChips ? `+${hiddenChips} more` : ''
    }
  }
  window.__refreshFilterPill = refreshFilterPill
  barFilters.addEventListener('change', refreshFilterPill)
  barFilters.addEventListener('click', refreshFilterPill)
  document.getElementById('bf-types-more').addEventListener('click', () => {
    barFilters.classList.toggle('bf-types-all')
    refreshFilterPill()
  })
  refreshFilterPill()
}

urlstate.bindControl('nodepos', 'f-nodepos', { checkbox: true })
urlstate.register({ key: 'types', get: () => window.currentTypes(), set: (v) => window.setTypes(v) })
urlstate.register({ key: 'idclass', get: () => window.currentIdClasses(), set: (v) => window.setIdClasses(v) })
// Captured before load(): the picker is wired further down (it needs the DOM),
// so 'senders' is not a registered field yet when load() normalizes the address
// bar — and normalizing drops unregistered keys, taking a pasted ?senders= with
// it. Same shape as wantLocate below, applied once the picker exists.
const initialSenders = urlstate.initial('senders', '')
const wantLocate = urlstate.initial('locate', '') === '1'
let locateRestored = false // wantLocate fires at most once, see applyRole() below
urlstate.register({ key: 'locate', get: () => (locateActive ? '1' : ''), set: () => {} }) // restored below

urlstate.load()
// The pill's count reads the controls urlstate just restored; without this a
// shared link opens narrowed with the pill claiming nothing (#539).
if (window.__refreshFilterPill) window.__refreshFilterPill()
// Cold start (#492): nothing restored a range, so this visit gets the default
// one. After load() rather than before it, and only when BOTH bounds are
// empty: a link carrying one bound is an open-ended range somebody chose, and
// pre-filling the other half would turn /?from=now-6h into "Last 6 hours".
// The rationale for the value itself is in filters.js.
if (!fFrom.value && !fTo.value) {
  fFrom.value = COLD_START_RANGE.from
  fTo.value = COLD_START_RANGE.to
  urlstate.save()
}
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

// ---- Ignore-list (#494) -------------------------------------------------
// Senders the viewer has dropped. Held here, like the picker selections, and
// read by filters.js through the same lazy window indirection. It leaves as
// repeated ?ignores= params, so the rows never reach the client and the hex
// layer honours it without a second code path (ignorelist.js says why).
let ignored = loadIgnore(window.localStorage)
// Declared here rather than beside the picker below: renderIgnoreList() reads
// it through knownLabelFor and runs before that block is evaluated.
let cachedIgnoreCandidates = []
let cachedIgnoreSig = null
window.ignoredSenderParams = () => ignoreParams(ignored)
window.isIgnoredSender = (ids) => isIgnored(ignored, ids)

// An ignored node is off the map and out of the target picker, so this list is
// the only place it can be found again, and a bare hex prefix names nothing to
// the person reading it. Three sources, best first: the label the node was
// heard under in this session, the resolver's cache, then the same 6-char
// prefix the rows use. Never the full id (#305, AGENTS.md §5.4) -- that is
// what the row's title carries.
//
// Nothing is stored alongside the id, so after a reload a node that has not
// been heard again falls back to its prefix. Storing a label would freeze a
// name the node can change, and the list is keyed by id either way.
function knownLabelFor(id) {
  for (const src of [cachedIgnoreCandidates, cachedCandidatePoints]) {
    const hit = (src || []).find((p) => p.sender_label && String(p.sender_id).toLowerCase() === id)
    if (hit) return String(hit.sender_label)
  }
  return cachedName(id) || ''
}

function ignoreRowLabel(id) {
  const name = knownLabelFor(id)
  return name ? { primary: name, secondary: id.slice(0, 6) } : { primary: id.slice(0, 6), secondary: '' }
}

function renderIgnoreList() {
  const listEl = document.getElementById('ss-ignore-list')
  if (!listEl) return
  listEl.replaceChildren()
  document.getElementById('ss-ignore-clear').hidden = ignored.size === 0
  if (ignored.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'ss-ignore-empty'
    empty.textContent = 'No ignored senders.'
    listEl.appendChild(empty)
    return
  }
  for (const id of ignored) {
    const { primary, secondary } = ignoreRowLabel(id)
    const row = document.createElement('div')
    row.className = 'ss-ignore-row'
    const label = document.createElement('span')
    label.className = 'ss-ignore-key'
    label.textContent = secondary ? `${primary} · ${secondary}` : primary
    label.title = id
    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'ss-ignore-remove'
    rm.textContent = 'Remove'
    rm.addEventListener('click', () => applyIgnore(toggleIgnore(ignored, id)))
    row.append(label, rm)
    listEl.appendChild(row)
  }
}

// One place for everything a change to the list has to touch. The candidate
// signature is cleared because the picker's own list is now different, and
// refreshPickerCandidates() would otherwise serve the cached one.
function applyIgnore(next) {
  ignored = next
  const saved = saveIgnore(window.localStorage, ignored)
  cachedCandidatureSig = null
  renderIgnoreList()
  // The picker holds its own Set, so every path that changes the list from
  // outside it (the popup button, Remove, Clear) has to write back into it.
  // setSelected on the picker that just fired onChange is a no-op reassignment
  // of the same ids, so this does not loop.
  if (ignorePicker) ignorePicker.setSelected([...ignored])
  syncIgnoreToggleLabel()
  refresh()
  if (!saved) setStatus('Ignore-list could not be saved (storage unavailable)')
}

// "Ignore this ID" in a point popup, delegated like the Locate button above.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.pp-ignore')
  if (!btn) return
  wm.closePopup()
  applyIgnore(toggleIgnore(ignored, btn.dataset.sender))
})

document.getElementById('ss-ignore-clear').addEventListener('click', () => applyIgnore(new Set()))
// Re-render on open, not only on change: a name can become known after the row
// was first drawn (a picker opened, a resolver answered), and the app does the
// same on its own sheet (app/src/app.js).
document.getElementById('settings-btn').addEventListener('click', () => renderIgnoreList())

// The ignore picker: the third instance of the multi-select popover, with the
// list itself as its selection. Checking a row ignores that node, unchecking
// it brings it back, so this is the only picker whose selection IS a filter
// rather than an input to one.
const igToggle = document.getElementById('ig-toggle')
const ignorePanel = document.getElementById('ignore-picker')
let ignorePicker = null

const ignoreAdapter = {
  idsOf: (rec) => (rec.merged_ids && rec.merged_ids.length ? rec.merged_ids : [rec.sender_id]),
  rowParts: (rec, nowMs) => {
    const { primary, secondary } = targetParts(rec)
    return { primary, secondary, meta: [{ text: relTime(rec.rx_at, nowMs), cls: 'tl-time' }] }
  },
  sigOf: (r) => (r.sender_label || r.sender_id || '') + r.rx_at,
  // No ignore option passed on purpose: this is the one list that has to keep
  // showing the nodes the list holds, or they could never be unchecked.
  list: (points, { limit } = {}) => senderList(points, { limit }),
}

function syncIgnoreToggleLabel() {
  igToggle.textContent = ignored.size ? `Ignored (${ignored.size}) ▾` : 'Ignored ▾'
  igToggle.classList.toggle('has-selection', ignored.size > 0)
}

// Candidates for this picker come from a query with the ignore-list stripped
// (withoutIgnoreFilter), unlike every other request the page makes.
async function refreshIgnoreCandidates() {
  if (!ignorePicker || !ignorePanel || ignorePanel.hidden) return
  const p = new URLSearchParams(viewportParams())
  const f = withoutIgnoreFilter((window.currentFilters && window.currentFilters()) || {})
  const sig = [...Object.entries(f).map(([k, v]) => `${k}=${v}`), `bbox=${p.get('bbox')}`, `z=${p.get('z')}`].sort().join('&')
  if (sig === cachedIgnoreSig) {
    ignorePicker.render(cachedIgnoreCandidates, Date.now())
    return
  }
  for (const [k, v] of Object.entries(f)) {
    if (k === 'senderPairs' || k === 'ignorePairs') { for (const [pk, pv] of v || []) p.append(pk, pv); continue }
    if (v) p.set(k, v)
  }
  try {
    const { points } = await fetchPointsPaged(p.toString(), { maxTotal: 25000 })
    cachedIgnoreCandidates = points
    cachedIgnoreSig = sig
    ignorePicker.render(points, Date.now())
  } catch (_) { /* keep the last good list; retried on the next open */ }
}

ignorePicker = createMultiSelectPicker(ignoreAdapter, document.getElementById('ig-list'), {
  onChange: () => applyIgnore(new Set(ignorePicker.getSelected())),
})
wirePopover({
  toggleEl: igToggle, panelEl: ignorePanel, wrapEl: igToggle.closest('.ms-wrap'), wrapSelector: '.ms-wrap',
  onOpen: () => { ignorePicker.reset(); refreshIgnoreCandidates() },
})

renderIgnoreList()
syncIgnoreToggleLabel()

// Target-list picker (#223): a small dropdown, a "toggle
// button reveals a panel" shape rather than app's full sheet -- web's top bar
// keeps every control inline (#225 decision), so this stays a compact
// popover, not a sheet. The hunter picker below (#290) shares the same shape.
const spToggle = document.getElementById('sp-toggle')
senderPicker = document.getElementById('sender-picker')
// The button is the only thing on screen once the panel closes, so it carries
// the selection (#495) -- the same lesson the hunter button records below, and
// the app's target chip solves the same way. targetChipLabel holds the rules
// (node count over id variants, no full-length id, the empty state); this only
// wires them to the DOM. Must be called from every path that moves the
// selection: a pick, Clear, the ?senders= restore, and the typing handler that
// drops a pick.
function syncTargetToggleLabel() {
  const ids = targetPicker.getSelected()
  // senderList() is the picker's own row set, so a merged node reads the same
  // on the button as in the list. It is only needed when something is picked,
  // and cachedCandidatePoints is empty until the panel has been opened once,
  // which is exactly when targetChipLabel falls back to nameOf.
  const { text, title, count } = targetChipLabel(ids, {
    rows: ids.length ? senderList(cachedCandidatePoints) : [],
    nameOf: (id) => cachedName(id) || '',
    // The typed prefix is inside the panel since #498, so the button is its
    // only trace once the panel closes.
    prefix: document.getElementById('f-sender').value,
  })
  spToggle.textContent = `${text} ▾`
  spToggle.title = title || 'Pick from heard senders'
  spToggle.classList.toggle('has-selection', count > 0)
}

targetPicker = createTargetPicker('f-sender', document.getElementById('tp-list'), {
  pinnedEl: document.getElementById('tp-pinned'),
  ignored: () => ignored,
  // The picker owns its selection now (#288), so the field's own input/urlstate
  // wiring no longer carries it -- refresh and persist explicitly instead.
  onChange: () => { syncTargetToggleLabel(); urlstate.save(); refresh() },
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
  if (e.target.value.trim() && targetPicker.getSelected().length) {
    targetPicker.setSelected([])
    urlstate.save()
    refresh()
  }
  syncTargetToggleLabel() // the button traces the prefix as well as a pick (#498)
})

// Selection persists as JSON: a sender_id is arbitrary operator text, so the
// stored form can no more be delimiter-joined than the query params can (#288).
urlstate.register({ key: 'senders',
  get: () => encodeSelection(targetPicker.getSelected()),
  set: (v) => { targetPicker.setSelected(decodeSelection(v)); syncTargetToggleLabel() } })
// load() already ran, so apply the pre-load capture now that the field exists.
if (initialSenders) targetPicker.setSelected(decodeSelection(initialSenders))
syncTargetToggleLabel()
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
window.__rxHighlightCount = () => (rxHighlightAt ? 1 : 0) // test hook
window.__rxHighlightLatLng = () => rxHighlightAt // test hook

// Role-aware boot: fetch /api/auth/me, wire the auth bar, and re-apply
// role-dependent UI (guest notice + Tasks 5/9 gating) whenever it changes.
initAuthBar(applyRole)

document.getElementById('role-notice-close').addEventListener('click', () => {
  document.getElementById('role-notice').hidden = true
})

// A hunter waiting to be verified leaves this page open, and nothing else
// re-reads /api/auth/me -- which is why the bar could keep saying "Hunter view"
// long after an admin had acted. Only re-applies when the role actually moved:
// applyRole re-runs the range and layer gates, and doing that on every tab
// switch would be cost for nothing.
window.addEventListener('focus', async () => {
  const me = await fetchMe()
  if ((me.role || 'guest') !== currentRole) applyRole(me)
})
