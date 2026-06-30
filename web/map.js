import { rssiTier, tierColorVar, fillOpacity } from './signal.js'
import { API_BASE } from './config.js'

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

// Theme: restore saved choice (default dark) before drawing so the basemap matches.
const BASEMAP = { dark: 'dark_all', light: 'light_all' }
let theme = localStorage.getItem('ch-theme') === 'light' ? 'light' : 'dark'
document.documentElement.setAttribute('data-theme', theme)

const map = L.map('map', { zoomControl: true }).setView([51, 4], 12)
const tileUrl = (t) => `https://{s}.basemaps.cartocdn.com/${BASEMAP[t]}/{z}/{x}/{y}{r}.png`
const tiles = L.tileLayer(tileUrl(theme), { maxZoom: 19 }).addTo(map)
const pointLayer = L.layerGroup().addTo(map)
const hexLayer = L.layerGroup().addTo(map)
let mode = 'points'
const bar = document.getElementById('bar')
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
  const r = await fetch(`${API_BASE}/api/points?${qs()}`); const d = await r.json()
  for (const pt of d.points || []) {
    const tier = rssiTier(pt.rssi)
    L.circleMarker([pt.lat, pt.lon], { radius: 5, color: cssVar(tierColorVar(tier)), weight: 1, fillColor: cssVar(tierColorVar(tier)), fillOpacity: fillOpacity(tier) })
      .bindPopup(`RSSI ${esc(pt.rssi)} · SNR ${esc(pt.snr)}<br>sender ${esc(pt.sender_label || pt.sender_id || '—')}<br>hunter ${esc(pt.hunter_name)}<br>${esc(pt.channel_name || pt.packet_type)}<br>${esc(pt.rx_at)}`)
      .addTo(pointLayer)
  }
  document.getElementById('status').textContent = `${(d.points||[]).length} points${d.truncated ? ' (capped)' : ''}`
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

let t = null
export function refresh() {
  clearTimeout(t)
  t = setTimeout(() => {
    if (mode === 'points' || mode === 'both') drawPoints(); else pointLayer.clearLayers()
    if (mode === 'hex' || mode === 'both') drawHex(); else hexLayer.clearLayers()
  }, 250)
}

document.getElementById('layer-toggle').addEventListener('click', (e) => {
  mode = mode === 'points' ? 'hex' : mode === 'hex' ? 'both' : 'points'
  e.target.textContent = mode
  refresh()
})
const themeBtn = document.getElementById('theme-toggle')
const syncThemeBtn = () => { themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️' }
syncThemeBtn()
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('ch-theme', theme)
  tiles.setUrl(tileUrl(theme))
  syncThemeBtn()
  refresh() // redraw markers/polygons so they pick up the new --ch-sig-* colors
})

map.on('moveend zoomend', refresh)
window.__refresh = refresh
refresh()
