// core-hunter orchestrator — wires BLE → capture → IndexedDB queue → MQTT,
// renders the map FROM the IndexedDB store (resilient to BLE/MQTT drops),
// drives the HUD and controls.
//
// Pipeline per 0x88 frame:
//   parseFrame → code check → decodePacket → classifyReception
//   → GPS fix (drop if none) → buildRecord → queue.add → updateHud
//
// Render tick (1s): non-destructive queue.takeAll() → makeFilter → map.render
// Drain tick (5s):  non-destructive queue.takeAll() → publish unpublished rows
//                   → add id to state.published Set (no queue.remove ever)

import { WebBluetoothTransport } from './transport.js'
import { parseFrame, PUSH_CODE_LOG_RX_DATA } from './frames.js'
import { initDecoder, decodePacket, channelNameFor, bytesToHex } from './decode.js'
import { classifyReception } from './meshpacket.js'
import { buildRecord, shouldCapture } from './capture.js'
import { Queue } from './queue.js'
import { Publisher } from './publisher.js'
import { Gps } from './gps.js'
import { requestSelfInfo } from './selfinfo.js'
import { loadConfig, getConfig } from './config.js'
import { createHuntMap } from './huntmap.js'
import { makeFilter } from './filters.js'
import { feedItems } from './feed.js'
import { createFeedPanel } from './feedpanel.js'
import { buildDiscoverFrame } from './discover.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Load persisted ignore-list (lowercase pubkeys). Non-fatal if missing/corrupt.
function loadIgnore() {
  try {
    const raw = localStorage.getItem('core-hunter-ignore')
    if (raw) return new Set(JSON.parse(raw))
  } catch (_) {}
  return new Set()
}

function saveIgnore(set) {
  try {
    localStorage.setItem('core-hunter-ignore', JSON.stringify([...set]))
  } catch (_) {}
}

// Load / save manual position override (dev only). Key: 'core-hunter-manual-fix'.
// Value: JSON { lat, lon, acc_m } or null.
function loadManualFix() {
  try {
    const raw = localStorage.getItem('core-hunter-manual-fix')
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return null
}

function saveManualFix(fix) {
  try {
    if (fix == null) localStorage.removeItem('core-hunter-manual-fix')
    else localStorage.setItem('core-hunter-manual-fix', JSON.stringify(fix))
  } catch (_) {}
}

const state = {
  transport: null,
  gps: new Gps(),
  queue: new Queue(),
  publisher: null,
  rxPubkey: '',
  name: '',
  map: null,
  feed: null,
  connected: false,
  // Drain dedup: in-memory Set of row ids already published this session.
  // Rows are NEVER deleted from IndexedDB — the local store is the hunter's
  // working set; re-publish dedup is the backend's concern (via raw+rx_at).
  // On app restart the Set is empty, so rows are republished; that is fine.
  published: new Set(),
  ignore: loadIgnore(),
  manualFix: loadManualFix(),
  filter: {
    sender: null,
    types: null,
    windowMs: 10 * 60 * 1000,
    directOnly: true,
  },
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id)

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

// RSSI → continuous bar marker percent.
// Maps calibrated RSSI from the weak end (-115 dBm) to the strong end (-75 dBm) → 0–100%.
function rssiToPct(rssi, offset) {
  if (rssi == null) return 10
  const calibrated = rssi + offset
  const WEAK = -115
  const STRONG = -75
  const clamped = Math.max(WEAK, Math.min(STRONG, calibrated))
  return Math.round(((clamped - WEAK) / (STRONG - WEAK)) * 100)
}

function updateHud(rec) {
  // Hero: RSSI (big green readout)
  const rssiEl = el('hud-rssi')
  if (rec.rssi != null) {
    rssiEl.innerHTML = rec.rssi + '<span class="unit"> dBm</span>'
  } else {
    rssiEl.textContent = '—'
  }

  // Secondary: SNR (small muted)
  el('hud-snr').textContent = rec.snr != null ? 'SNR ' + rec.snr.toFixed(1) + ' dB' : 'SNR —'

  // Thermal bar marker — continuous position from RSSI
  const offset = (getConfig() && getConfig().rssiCalibrationOffset) || 0
  const pct = rssiToPct(rec.rssi, offset)
  el('hud-bar-marker').style.left = pct + '%'
}

function setDot(id, on) {
  const d = el(id)
  if (on) d.classList.add('on')
  else d.classList.remove('on')
}

// ---------------------------------------------------------------------------
// Capture pipeline
// ---------------------------------------------------------------------------

async function processFrame(dv) {
  const frame = parseFrame(dv)
  if (!frame || frame.code !== PUSH_CODE_LOG_RX_DATA) return
  let decoded
  try { decoded = decodePacket(bytesToHex(frame.raw)) } catch (e) { return }
  if (!decoded || !decoded.isValid) return
  const cls = classifyReception(decoded, channelNameFor)
  if (!shouldCapture(cls)) return

  const fix = state.manualFix || state.gps.latest()
  if (!fix) return

  const rec = buildRecord(frame, cls, fix, new Date().toISOString())
  rec._text = cls.text // local-only, for the popup; stripped before publish
  await state.queue.add(rec)
  updateHud(rec)
}

// ---------------------------------------------------------------------------
// Render tick — reads ALL rows non-destructively (~every 1 s)
// ---------------------------------------------------------------------------
// queue.takeAll() uses a readonly IDB transaction (getAll) — it does NOT
// delete rows. It is safe to call it from the render path.

async function renderTick() {
  try {
    setDot('dot-mqtt', state.publisher != null && state.publisher.connected())
    const rows = await state.queue.takeAll()
    const now = Date.now()
    if (state.map) {
      const fn = makeFilter({ ...state.filter, ignore: state.ignore })
      state.map.render(rows.filter((r) => fn(r, now)), now)
    }
    if (state.feed) state.feed.render(feedItems(rows, { ignore: state.ignore, limit: 50 }), now)
  } catch (_) {
    // silent — render failure must not crash the loop
  }
  setTimeout(renderTick, 1000)
}

// ---------------------------------------------------------------------------
// Drain tick — publish pending rows to MQTT (~every 5 s)
// ---------------------------------------------------------------------------
// Dedup via state.published (in-memory Set of row ids).
// Rows are NEVER removed from IndexedDB. If publish fails, the row stays
// unpublished and will be retried on the next drain.

async function drainLoop() {
  if (state.publisher && state.publisher.connected() && state.rxPubkey) {
    try {
      const rows = await state.queue.takeAll()
      let n = 0
      for (const r of rows) {
        if (state.published.has(r.id)) continue
        try {
          await state.publisher.publish(state.rxPubkey, r, state.name)
          state.published.add(r.id)
          n++
        } catch (_) {
          // publish failed — leave for next drain
        }
      }
      if (n > 0) console.debug('[drain] published', n, 'record(s)')
    } catch (_) {
      // queue read failed — retry next cycle
    }
  }
  setTimeout(drainLoop, 5000)
}

// ---------------------------------------------------------------------------
// Single-shot discover
// ---------------------------------------------------------------------------

function sendDiscover() {
  if (!state.connected || !state.transport) return
  const tag = crypto.getRandomValues(new Uint8Array(4))
  state.transport.send(buildDiscoverFrame(tag)).catch(() => {})
}

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

async function connectAll() {
  const btn = el('connect-btn')
  btn.disabled = true
  btn.textContent = 'Connecting…'

  try {
    // Dispose any prior transport first. On a spontaneous BLE drop the old
    // transport stays in its reconnect backoff loop (_intentional=false); without
    // this, a fresh connect would orphan it and double-capture once it reconnects.
    if (state.transport) {
      try { await state.transport.disconnect() } catch (_) {}
      state.transport = null
    }

    // 1. BLE transport
    state.transport = new WebBluetoothTransport()
    state.transport.onStatus((s) => {
      const on = s === 'connected'
      setDot('dot-ble', on)
      if (!on) state.connected = false
    })
    await state.transport.connect()
    state.connected = true
    setDot('dot-ble', true)

    // 2. Self info (companion pubkey + name)
    const info = await requestSelfInfo(state.transport, 'core-hunter')
    state.rxPubkey = info.pubkey.toLowerCase()
    state.name = info.name || ''

    // 3. GPS
    state.gps.start((fix) => {
      if (state.map) state.map.setPosition(fix.lat, fix.lon)
    })

    // 4. MQTT publisher
    const cfg = getConfig()
    if (cfg && cfg.mqttUrl) {
      state.publisher = new Publisher({
        url: cfg.mqttUrl,
        username: cfg.mqttUsername,
        password: cfg.mqttPassword,
        clientId: state.rxPubkey,
      })
      await state.publisher.connect()
      setDot('dot-mqtt', true)
    }

    // 5. Register frame handler
    state.transport.onFrame(processFrame)

    btn.textContent = 'Disconnect'
    btn.disabled = false
    el('discover-btn').disabled = false
  } catch (e) {
    console.error('[connect]', e)
    btn.textContent = 'Connect (retry)'
    btn.disabled = false
    await disconnectAll(true)
  }
}

async function disconnectAll(silent) {
  setDot('dot-ble', false)
  setDot('dot-mqtt', false)
  state.connected = false
  el('discover-btn').disabled = true

  if (state.publisher) { state.publisher.end(); state.publisher = null }
  try { state.gps.stop() } catch (_) {}
  if (state.transport) {
    try { await state.transport.disconnect() } catch (_) {}
    state.transport = null
  }

  if (!silent) {
    const btn = el('connect-btn')
    btn.textContent = 'Connect'
    btn.disabled = false
  }
}

// ---------------------------------------------------------------------------
// Filter sheet helpers
// ---------------------------------------------------------------------------

const FILTER_PACKET_TYPES = [
  { value: 'Advert',      label: 'Advert' },
  { value: 'GroupText',   label: 'Channel' },
  { value: 'Response',    label: 'Response' },
  { value: 'Request',     label: 'Request' },
  { value: 'TextMessage', label: 'Direct msg' },
  { value: 'Ack',         label: 'Ack' },
  { value: 'Trace',       label: 'Trace' },
]

function buildFilterSheet() {
  const sheet = el('filter-sheet')
  sheet.innerHTML = `
    <div class="filter-sheet-inner">
      <h2>Filters</h2>
      <label>
        <input type="checkbox" id="fs-direct-only" />
        Direct only
      </label>
      <label>
        Window
        <select id="fs-window">
          <option value="600000">10 min</option>
          <option value="1800000">30 min</option>
          <option value="3600000">1 h</option>
          <option value="0">All time</option>
        </select>
      </label>
      <div class="fs-type-row">
        <span class="fs-type-label">Types</span>
        <div id="fs-type-chips" class="fs-type-chips">
          ${FILTER_PACKET_TYPES.map(t => `<button class="fs-chip" data-type="${t.value}">${t.label}</button>`).join('')}
        </div>
      </div>
      <button id="fs-close">Done</button>
    </div>`

  const chk = el('fs-direct-only')
  const sel = el('fs-window')

  chk.checked = state.filter.directOnly
  sel.value = String(state.filter.windowMs)

  chk.addEventListener('change', () => { state.filter.directOnly = chk.checked })
  sel.addEventListener('change', () => { state.filter.windowMs = Number(sel.value) || null })

  // Type chips — clicking a chip toggles it; when nothing is selected, types → null
  el('fs-type-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.fs-chip')
    if (!chip) return
    chip.classList.toggle('active')
    const selected = [...el('fs-type-chips').querySelectorAll('.fs-chip.active')]
      .map(c => c.dataset.type)
    state.filter.types = selected.length > 0 ? new Set(selected) : null
  })

  el('fs-close').addEventListener('click', () => { sheet.hidden = true })
}

function renderIgnoreList(listEl) {
  listEl.innerHTML = ''
  if (state.ignore.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'ss-ignore-empty'
    empty.textContent = 'No ignored stations.'
    listEl.appendChild(empty)
    return
  }
  for (const key of state.ignore) {
    const row = document.createElement('div')
    row.className = 'ss-ignore-row'
    const label = document.createElement('span')
    label.className = 'ss-ignore-key'
    label.textContent = key.slice(0, 12) + '…'
    label.title = key
    const rm = document.createElement('button')
    rm.className = 'ss-ignore-remove'
    rm.textContent = 'Remove'
    rm.addEventListener('click', () => {
      state.ignore.delete(key)
      saveIgnore(state.ignore)
      renderIgnoreList(listEl)
    })
    row.appendChild(label)
    row.appendChild(rm)
    listEl.appendChild(row)
  }
}

function updateManualFixStatus(statusEl) {
  const f = state.manualFix
  statusEl.textContent = f
    ? `Manual position: ${f.lat}, ${f.lon} — overriding GPS`
    : 'off'
  statusEl.classList.toggle('ss-manfix-active', !!f)
}

function buildSettingsSheet() {
  const sheet = el('settings-sheet')
  sheet.innerHTML = `
    <div class="settings-sheet-inner">
      <h2>Settings</h2>
      <label>
        <input type="checkbox" id="ss-theme" />
        Light theme
      </label>
      <div class="ss-ignore-section">
        <h3>Ignored stations</h3>
        <div id="ss-ignore-list"></div>
        <button id="ss-ignore-clear">Clear ignore-list</button>
      </div>
      <div class="ss-manfix-section">
        <h3>Manual position (dev)</h3>
        <div class="ss-manfix-inputs">
          <label class="ss-manfix-label">
            Lat
            <input type="number" id="ss-manfix-lat" step="any" placeholder="51.05" />
          </label>
          <label class="ss-manfix-label">
            Lon
            <input type="number" id="ss-manfix-lon" step="any" placeholder="3.72" />
          </label>
        </div>
        <div class="ss-manfix-error" id="ss-manfix-error" hidden></div>
        <div class="ss-manfix-actions">
          <button id="ss-manfix-set">Set</button>
          <button id="ss-manfix-clear">Clear</button>
        </div>
        <p id="ss-manfix-status" class="ss-manfix-status"></p>
      </div>
      <p class="ss-version">core-hunter v${__APP_VERSION__}</p>
      <button id="ss-close">Done</button>
    </div>`

  const chk = el('ss-theme')
  chk.checked = document.documentElement.dataset.theme === 'light'
  chk.addEventListener('change', () => {
    const theme = chk.checked ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    if (state.map) state.map.applyBasemap()
  })

  renderIgnoreList(el('ss-ignore-list'))

  el('ss-ignore-clear').addEventListener('click', () => {
    state.ignore.clear()
    saveIgnore(state.ignore)
    renderIgnoreList(el('ss-ignore-list'))
  })

  // Manual position — prefill inputs from persisted state
  const latInput = el('ss-manfix-lat')
  const lonInput = el('ss-manfix-lon')
  const statusEl = el('ss-manfix-status')
  const errorEl = el('ss-manfix-error')

  if (state.manualFix) {
    latInput.value = state.manualFix.lat
    lonInput.value = state.manualFix.lon
  }
  updateManualFixStatus(statusEl)

  el('ss-manfix-set').addEventListener('click', () => {
    errorEl.hidden = true
    const lat = parseFloat(latInput.value)
    const lon = parseFloat(lonInput.value)
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      errorEl.textContent = 'Invalid coordinates. Lat −90..90, Lon −180..180.'
      errorEl.hidden = false
      return
    }
    state.manualFix = { lat, lon, acc_m: 10 }
    saveManualFix(state.manualFix)
    updateManualFixStatus(statusEl)
    if (state.map) {
      state.map.setPosition(lat, lon)
      state.map.centerOn(lat, lon)
    }
  })

  el('ss-manfix-clear').addEventListener('click', () => {
    errorEl.hidden = true
    state.manualFix = null
    saveManualFix(null)
    updateManualFixStatus(statusEl)
  })

  el('ss-close').addEventListener('click', () => { sheet.hidden = true })
}

// ---------------------------------------------------------------------------
// Layer-mode cycling
// ---------------------------------------------------------------------------

const LAYER_MODES = ['both', 'points', 'hex']
let layerIdx = 0

function cycleLayer() {
  layerIdx = (layerIdx + 1) % LAYER_MODES.length
  if (state.map) state.map.setLayerMode(LAYER_MODES[layerIdx])
}

// ---------------------------------------------------------------------------
// Isolate-sender event
// ---------------------------------------------------------------------------

document.addEventListener('hunt:isolate-sender', (e) => {
  state.filter.sender = (e.detail && e.detail.id) ? { id: e.detail.id } : null
  const chip = el('target-chip')
  if (e.detail && e.detail.id) {
    chip.textContent = '⌖ ' + String(e.detail.id).slice(0, 12)
    chip.classList.add('active')
  } else {
    chip.textContent = 'No target'
    chip.classList.remove('active')
  }
})

// ---------------------------------------------------------------------------
// Ignore-sender event
// ---------------------------------------------------------------------------

document.addEventListener('hunt:ignore-sender', (e) => {
  if (!e.detail || !e.detail.id) return
  state.ignore.add(String(e.detail.id).toLowerCase())
  saveIgnore(state.ignore)
  // next renderTick picks up the updated set automatically
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  // Load runtime config (non-fatal if missing — user may be offline)
  try {
    await loadConfig()
  } catch (e) {
    console.warn('[config]', e.message)
  }
  initDecoder((getConfig() || {}).channelKeys, (getConfig() || {}).channels)

  // Initialise map
  state.map = createHuntMap('map')

  // Initialise feed panel
  state.feed = createFeedPanel('feed-panel', {
    onTapRow: (rec) => { if (state.map) state.map.focusReception(rec) },
    onIsolate: (id) => document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id } })),
    onIgnore: (id) => document.dispatchEvent(new CustomEvent('hunt:ignore-sender', { detail: { id } })),
  })

  // Publish the real HUD height as --ch-hud-h so #feed-panel sits above it
  const hudEl = document.getElementById('hud')
  if (hudEl) {
    const setHudH = () => document.documentElement.style.setProperty('--ch-hud-h', hudEl.offsetHeight + 'px')
    setHudH()
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setHudH).observe(hudEl)
    window.addEventListener('resize', setHudH)
  }

  // Build sheets (static HTML injected once)
  buildFilterSheet()
  buildSettingsSheet()

  // Wire controls
  el('connect-btn').addEventListener('click', () => {
    if (state.connected) disconnectAll()
    else connectAll()
  })

  el('discover-btn').addEventListener('click', sendDiscover)

  el('layer-toggle').addEventListener('click', cycleLayer)

  // Recenter button — re-enables follow mode and snaps back to my position.
  // Hidden while following; the map reveals it once the user pans away.
  el('recenter-btn').addEventListener('click', () => { if (state.map) state.map.recenter() })
  if (state.map) state.map.onFollowChange((following) => { el('recenter-btn').hidden = following })

  el('filter-btn').addEventListener('click', () => {
    const sheet = el('filter-sheet')
    sheet.hidden = !sheet.hidden
    if (!sheet.hidden) el('settings-sheet').hidden = true
  })

  el('settings-btn').addEventListener('click', () => {
    const sheet = el('settings-sheet')
    sheet.hidden = !sheet.hidden
    if (!sheet.hidden) {
      el('filter-sheet').hidden = true
      renderIgnoreList(el('ss-ignore-list'))
      updateManualFixStatus(el('ss-manfix-status'))
    }
  })

  // Target chip tap → clear isolation
  el('target-chip').addEventListener('click', () => {
    if (state.filter.sender) {
      document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: null }))
    }
  })

  // Start background loops
  renderTick()
  drainLoop()
})
