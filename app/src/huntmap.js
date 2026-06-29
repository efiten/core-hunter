import { hexCellAt, hexBoundary } from './hexgrid.js'
import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { getConfig } from './config.js'

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function createHuntMap(containerId) {
  if (typeof L === 'undefined') return { setPosition() {}, centerOn() {}, recenter() {}, onFollowChange() {}, render() {}, setLayerMode() {}, applyBasemap() {}, focusReception() {}, destroy() {} }
  const cfg = getConfig()
  const offset = (cfg && cfg.rssiCalibrationOffset) || 0
  const map = L.map(containerId, { zoomControl: false }).setView([51, 4], 14)
  const TILES = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  }
  let base = null
  function applyBasemap() {
    const which = cssVar('--ch-basemap') || 'dark'
    if (base) map.removeLayer(base)
    base = L.tileLayer(TILES[which] || TILES.dark, { maxZoom: 19 }).addTo(map)
  }
  applyBasemap()
  const pointLayer = L.layerGroup().addTo(map)
  const hexLayer = L.layerGroup().addTo(map)
  let mode = 'both', here = null

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

  function pointStyle(rec) {
    const tier = rssiTier(rec.rssi, offset)
    const color = cssVar(tierColorVar(tier))
    return {
      radius: 8,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: fillOpacity(tier),
    }
  }

  function render(records, nowMs) {
    if (popupOpen) return   // don't rebuild markers while the user is inspecting a popup (it would close it)
    pointLayer.clearLayers(); hexLayer.clearLayers()
    if (mode !== 'hex') {
      for (const r of records) {
        if (r.lat == null || r.lon == null) continue
        const m = L.circleMarker([r.lat, r.lon], pointStyle(r))
        m.bindPopup(popupHtml(r))
        m.on('popupopen', (e) => { wireIsolate(e.popup, r); wireIgnore(e.popup, r) })
        m.addTo(pointLayer)
      }
    }
    if (mode !== 'points') {
      const cells = new Map()
      for (const r of records) {
        if (r.lat == null || r.lon == null) continue
        const id = hexCellAt(r.lat, r.lon, 11)
        const cur = cells.get(id)
        if (!cur || (r.rssi ?? -999) > (cur.best ?? -999)) cells.set(id, { best: r.rssi })
      }
      for (const [id, c] of cells) {
        // hexBoundary returns [lat,lon] pairs (closed ring) — directly usable by L.polygon
        const ring = hexBoundary(id); if (!ring) continue
        const tier = rssiTier(c.best, offset)
        L.polygon(ring, { color: cssVar(tierColorVar(tier)), weight: 1,
          fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) }).addTo(hexLayer)
      }
    }
  }
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
  function setLayerMode(m) { mode = m }
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    centerOn(rec.lat, rec.lon)
    const popup = L.popup({ autoPan: true }).setLatLng([rec.lat, rec.lon]).setContent(popupHtml(rec)).openOn(map)
    wireIsolate(popup, rec)
    wireIgnore(popup, rec)
  }
  function destroy() { map.remove() }
  return { setPosition, centerOn, recenter, onFollowChange, render, setLayerMode, applyBasemap, focusReception, destroy }
}

function popupHtml(r) {
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const senderLine = r.sender_id
    ? `${r.sender_kind === 'channel_name' ? 'name' : r.sender_kind === 'advert_pubkey' ? 'node' : 'src'} ${esc(r.sender_label || r.sender_id)}`
    : 'sender — (none)'
  const chanLine = r.channel_name ? `<br>channel ${esc(r.channel_name)}` : ''
  const textLine = r._text ? `<br>"${esc(r._text)}"` : ''
  return `<div class="ch-popup">SNR ${esc(r.snr)} · RSSI ${esc(r.rssi)}<br>`
    + `${esc(r.packet_type)}<br>`
    + senderLine + chanLine + textLine + '<br>'
    + `<button class="ch-isolate" ${r.sender_id ? '' : 'disabled'}>Isolate sender</button>`
    + ` <button class="ch-ignore" ${r.sender_id ? '' : 'disabled'}>Ignore this ID</button></div>`
}
function wireIsolate(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-isolate')
  if (btn && r.sender_id) btn.onclick = () => document.dispatchEvent(
    new CustomEvent('hunt:isolate-sender', { detail: { id: r.sender_id } }))
}
function wireIgnore(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-ignore')
  if (btn && r.sender_id) btn.onclick = () => document.dispatchEvent(
    new CustomEvent('hunt:ignore-sender', { detail: { id: r.sender_id } }))
}
