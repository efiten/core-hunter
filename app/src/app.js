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
import { makeFilter, isFilterActive, DEFAULT_FILTER } from './filters.js'
import { isSettingsActive } from './settings.js'
import { sinceLabel } from './elapsed.js'
import { effectivePlotOffset } from './signal.js'
import { feedItems } from './feed.js'
import { createFeedPanel } from './feedpanel.js'
import { createTargetList } from './targetlist.js'
import { resolveName, cachedName, resolvableKey } from './names.js'
import { buildDiscoverFrame } from './discover.js'
import { createWakeLock } from './wakelock.js'
import { splashState, SPLASH_COPY, SPLASH_DISCLAIMER, SPLASH_TIPS, pickTip } from './splash.js'

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

const initialManualFix = loadManualFix()

// Attenuator setting (dB, non-positive: 0/-10/-20/-30). Persisted; added back to
// plotted RSSI so the picture stays consistent when an external attenuator is on.
function loadAttenuator() {
  const v = Number(localStorage.getItem('core-hunter-attenuator'))
  return v === -10 || v === -20 || v === -30 ? v : 0
}

function saveAttenuator(db) {
  try { localStorage.setItem('core-hunter-attenuator', String(db)) } catch (_) {}
}

const state = {
  transport: null,
  gps: new Gps(),
  queue: new Queue(),
  publisher: null,
  rxPubkey: '',
  name: '',
  sf: null,   // companion spreading factor (from SELF_INFO), null until known
  map: null,
  feed: null,
  targetList: null,
  connected: false,
  wakeLock: null,
  // Drain dedup: in-memory Set of row ids already published this session.
  // Rows are NEVER deleted from IndexedDB — the local store is the hunter's
  // working set; re-publish dedup is the backend's concern (via raw+rx_at).
  // On app restart the Set is empty, so rows are republished; that is fine.
  published: new Set(),
  ignore: loadIgnore(),
  manualFix: initialManualFix,
  attenuatorDb: loadAttenuator(),
  // Epoch ms of the most recent captured reception, for the "since last packet"
  // HUD timer. null until the first packet is heard this session.
  lastPacketAt: null,
  filter: { ...DEFAULT_FILTER },
  // Startup splash (see splash.js) — hides once hasFix flips true. A manual
  // fix override (dev only) counts as having a fix already.
  hasFix: !!initialManualFix,
  bleError: false,
  gpsError: false,
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

  // Thermal bar marker — continuous position from RSSI (calibration + attenuator)
  const offset = effectivePlotOffset(getConfig() && getConfig().rssiCalibrationOffset, state.attenuatorDb)
  const pct = rssiToPct(rec.rssi, offset)
  el('hud-bar-marker').style.left = pct + '%'
}

function setDot(id, on) {
  const d = el(id)
  if (on) d.classList.add('on')
  else d.classList.remove('on')
}

// Light the filter button's badge when the view is narrowed — either the filter
// differs from the default or the ignore-list (also a display filter) is
// non-empty. Closed-sheet signal; called wherever state.filter or state.ignore
// changes.
function refreshFilterIndicator() {
  el('filter-btn').classList.toggle('active', isFilterActive(state.filter) || state.ignore.size > 0)
}

// Light the settings button's badge when a setting differs from default
// (attenuator non-zero, or manual position override set). Call wherever
// state.attenuatorDb or state.manualFix changes.
function refreshSettingsIndicator() {
  el('settings-btn').classList.toggle('active', isSettingsActive(state))
}

// Rotating splash tips: the pinned disclaimer plus one cycling hunting tip,
// shown only while waiting for a GPS fix so the wait is spent learning to hunt.
let tipTimer = null
let tipIdx = 0
function showTip() { el('splash-tip').textContent = pickTip(SPLASH_TIPS, tipIdx) }
function startTipRotation() {
  el('splash-disclaimer').textContent = SPLASH_DISCLAIMER
  if (tipTimer) return // already rotating
  showTip()
  tipTimer = setInterval(() => { tipIdx++; showTip() }, 6000)
}
function stopTipRotation() {
  if (tipTimer) { clearInterval(tipTimer); tipTimer = null }
}

// Splash: shown until the first GPS fix, per splashState(). Call wherever
// hasFix/connected/bleError/gpsError changes.
function refreshSplash() {
  const s = splashState(state)
  el('splash').hidden = s === 'hidden'
  // Tips + disclaimer only during the actual GPS wait; stop the timer otherwise.
  const showTips = s === 'waiting-gps'
  el('splash-disclaimer').hidden = !showTips
  el('splash-tip').hidden = !showTips
  if (showTips) startTipRotation()
  else stopTipRotation()
  if (s === 'hidden') return
  el('splash-status').textContent = SPLASH_COPY[s]
  el('splash-retry-gps').hidden = s !== 'gps-error'
}

// (Re-)starts the GPS watch, e.g. on connect or after the user retries
// location from the splash. Shared so both call sites update state the same way.
function startGpsWatch() {
  state.gps.start(
    (fix) => {
      if (state.map) state.map.setPosition(fix.lat, fix.lon)
      if (!state.hasFix) { state.hasFix = true; refreshSplash() }
    },
    () => { state.gpsError = true; refreshSplash() }
  )
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
  state.lastPacketAt = Date.now()
  updateHud(rec)
}

// ---------------------------------------------------------------------------
// Render tick — reads ALL rows non-destructively (~every 1 s)
// ---------------------------------------------------------------------------
// queue.takeAll() uses a readonly IDB transaction (getAll) — it does NOT
// delete rows. It is safe to call it from the render path.

// enrichNames fills sender_label from the CoreScope resolver for senders whose
// full pubkey is known but have no name yet. Cache hits are applied in-place;
// misses fire a one-shot lookup that populates the cache for a later tick (the
// row objects are fresh from IndexedDB each tick, so mutation is local).
function enrichNames(rows) {
  for (const r of rows) {
    const key = resolvableKey(r)
    if (!key) continue
    const hit = cachedName(key)
    if (hit === undefined) resolveName(key, state.sf).catch(() => {})
    else if (hit) r.sender_label = hit
  }
}

async function renderTick() {
  try {
    setDot('dot-mqtt', state.publisher != null && state.publisher.connected())
    const rows = await state.queue.takeAll()
    const now = Date.now()
    el('hud-since').textContent = sinceLabel(now, state.lastPacketAt)
    enrichNames(rows)
    if (state.map) {
      const fn = makeFilter({ ...state.filter, ignore: state.ignore })
      state.map.render(rows.filter((r) => fn(r, now)), now)
    }
    if (state.feed) state.feed.render(feedItems(rows, { ignore: state.ignore, limit: 50 }), now)
    if (state.targetList) state.targetList.render(rows, state.ignore, now)
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
  state.bleError = false
  state.gpsError = false
  refreshSplash()

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
    refreshSplash()

    // 2. Self info (companion pubkey + name + spreading factor)
    const info = await requestSelfInfo(state.transport, 'core-hunter')
    state.rxPubkey = info.pubkey.toLowerCase()
    state.name = info.name || ''
    state.sf = info.sf ?? null

    // 3. GPS
    startGpsWatch()

    // 4. MQTT publisher — non-fatal. Receptions are written to IndexedDB first
    // and the drain loop publishes them, so a slow or unreachable broker must not
    // fail the connect or tear down BLE. Connect in the background; the render
    // tick keeps dot-mqtt in sync with the live publisher state.
    const cfg = getConfig()
    if (cfg && cfg.mqttUrl) {
      state.publisher = new Publisher({
        url: cfg.mqttUrl,
        username: cfg.mqttUsername,
        password: cfg.mqttPassword,
        clientId: state.rxPubkey,
      })
      state.publisher.connect()
        .then(() => setDot('dot-mqtt', true))
        .catch((e) => console.error('[mqtt]', e))
    }

    // 5. Register frame handler
    state.transport.onFrame(processFrame)

    setHuntingChrome(true)
    el('discover-btn').disabled = false
    refreshConnState()
  } catch (e) {
    console.error('[connect]', e)
    btn.textContent = 'Connect (retry)'
    btn.disabled = false
    state.bleError = true
    await disconnectAll(true)
  }
}

// Once connected the Connect button and the (non-interactive) thermal bar are
// hidden so the hunting HUD is just the live readout + map. They stay visible
// during "Connecting…" and reappear on disconnect.
function setHuntingChrome(connected) {
  el('connect-btn').hidden = connected
  el('hud-bar').hidden = connected
  el('hud-bar-labels').hidden = connected
  // HUD height changed → recompute --ch-hud-h (drives the #feed-panel offset)
  window.dispatchEvent(new Event('resize'))
}

// Mirror the connection state into the BLE-settings Connection section. No-op
// until the settings sheet has been built.
function refreshConnState() {
  const dc = el('ss-disconnect')
  if (!dc) return
  const connected = state.connected
  dc.disabled = !connected
  el('ss-conn-name').textContent = state.name || '—'
  el('ss-conn-key').textContent = state.rxPubkey ? state.rxPubkey.slice(0, 12) + '…' : '—'
  el('ss-conn-sf').textContent = state.sf ? 'SF' + state.sf : '—'
  el('ss-conn-ble').textContent = connected ? 'Connected' : 'Not connected'
  el('ss-conn-mqtt').textContent =
    state.publisher && state.publisher.connected() ? 'Connected' : 'Not connected'
}

async function disconnectAll(silent) {
  setDot('dot-ble', false)
  setDot('dot-mqtt', false)
  state.connected = false
  el('discover-btn').disabled = true

  if (state.wakeLock) state.wakeLock.disable()
  if (state.publisher) { state.publisher.end(); state.publisher = null }
  try { state.gps.stop() } catch (_) {}
  if (state.transport) {
    try { await state.transport.disconnect() } catch (_) {}
    state.transport = null
  }

  setHuntingChrome(false)
  refreshConnState()
  refreshSplash()

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
      <div class="sheet-head">
        <h2>Filters</h2>
        <button class="sheet-close" id="fs-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
      <label class="fs-row">
        <span>Direct only</span>
        <input type="checkbox" id="fs-direct-only" />
      </label>
      <label class="fs-row">
        <span>Plot last:</span>
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
          <button class="fs-chip active" data-type="all">All</button>
          ${FILTER_PACKET_TYPES.map(t => `<button class="fs-chip" data-type="${t.value}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div class="ss-ignore-section">
        <h3>Ignored stations</h3>
        <div id="ss-ignore-list"></div>
        <button id="ss-ignore-clear">Clear ignore-list</button>
      </div>
    </div>`

  const chk = el('fs-direct-only')
  const sel = el('fs-window')

  chk.checked = state.filter.directOnly
  sel.value = String(state.filter.windowMs)

  chk.addEventListener('change', () => { state.filter.directOnly = chk.checked; refreshFilterIndicator() })
  sel.addEventListener('change', () => { state.filter.windowMs = Number(sel.value) || null; refreshFilterIndicator() })

  // Type chips — the "All" chip (default) means no type filter. Picking a
  // specific type turns All off; clearing the last specific turns All back on.
  el('fs-type-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.fs-chip')
    if (!chip) return
    const chips = el('fs-type-chips')
    const allChip = chips.querySelector('.fs-chip[data-type="all"]')

    if (chip === allChip) {
      if (allChip.classList.contains('active')) return // already showing all — no-op
      allChip.classList.add('active')
      chips.querySelectorAll('.fs-chip:not([data-type="all"]).active').forEach(c => c.classList.remove('active'))
    } else {
      chip.classList.toggle('active')
      allChip.classList.remove('active')
    }

    const selected = [...chips.querySelectorAll('.fs-chip.active')]
      .map(c => c.dataset.type)
      .filter(t => t !== 'all')
    if (selected.length === 0) {
      allChip.classList.add('active')   // nothing specific → fall back to All
      state.filter.types = null
    } else {
      state.filter.types = new Set(selected)
    }
    refreshFilterIndicator()
  })

  renderIgnoreList(el('ss-ignore-list'))
  el('ss-ignore-clear').addEventListener('click', () => {
    state.ignore.clear()
    saveIgnore(state.ignore)
    renderIgnoreList(el('ss-ignore-list'))
    refreshFilterIndicator()
  })

  el('fs-close').addEventListener('click', () => { sheet.hidden = true })
}

function buildTargetSheet() {
  const sheet = el('target-sheet')
  sheet.innerHTML = `
    <div class="target-sheet-inner">
      <div class="sheet-head">
        <h2>Target</h2>
        <button class="sheet-close" id="ts-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
      <button type="button" id="ts-clear" class="tl-clear" hidden>Clear target (showing all)</button>
      <div class="tl-pinned-label">Top</div>
      <ul id="ts-pinned" class="tl-list tl-pinned"></ul>
      <div class="tl-pinned-label">All senders</div>
      <ul id="ts-list" class="tl-list"></ul>
    </div>`

  state.targetList = createTargetList(el('ts-list'), {
    pinnedEl: el('ts-pinned'),
    onSelect: (id) => {
      document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id } }))
      sheet.hidden = true
    },
  })

  el('ts-clear').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: null }))
    sheet.hidden = true
  })

  el('ts-close').addEventListener('click', () => { sheet.hidden = true })
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
      refreshFilterIndicator()
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
      <div class="sheet-head">
        <h2>Settings</h2>
        <button class="sheet-close" id="ss-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
      <div class="ss-conn-section">
        <h3>Connection</h3>
        <dl class="ss-conn-status">
          <dt>Companion</dt><dd id="ss-conn-name">—</dd>
          <dt>Pubkey</dt><dd id="ss-conn-key">—</dd>
          <dt>Spreading factor</dt><dd id="ss-conn-sf">—</dd>
          <dt>BLE</dt><dd id="ss-conn-ble">—</dd>
          <dt>MQTT</dt><dd id="ss-conn-mqtt">—</dd>
        </dl>
        <button id="ss-disconnect" class="ss-disconnect" disabled>Disconnect</button>
      </div>
      <div class="ss-radio-section">
        <h3>Radio</h3>
        <label class="ss-radio-row">
          <span>Attenuator</span>
          <select id="ss-atten">
            <option value="0">0 dB</option>
            <option value="-10">−10 dB</option>
            <option value="-20">−20 dB</option>
            <option value="-30">−30 dB</option>
          </select>
        </label>
      </div>
      <label>
        <input type="checkbox" id="ss-theme" />
        Light theme
      </label>
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
    </div>`

  el('ss-disconnect').addEventListener('click', () => {
    disconnectAll()
    sheet.hidden = true
  })
  refreshConnState()

  const atten = el('ss-atten')
  atten.value = String(state.attenuatorDb)
  atten.addEventListener('change', () => {
    state.attenuatorDb = Number(atten.value) || 0
    saveAttenuator(state.attenuatorDb)
    if (state.map) state.map.setAttenuator(state.attenuatorDb)
    refreshSettingsIndicator()
  })

  const chk = el('ss-theme')
  chk.checked = document.documentElement.dataset.theme === 'light'
  chk.addEventListener('change', () => {
    const theme = chk.checked ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    if (state.map) state.map.applyBasemap()
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
    refreshSettingsIndicator()
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
    refreshSettingsIndicator()
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
  const clearBtn = el('ts-clear')
  if (clearBtn) clearBtn.hidden = !state.filter.sender
  refreshFilterIndicator()
})

// ---------------------------------------------------------------------------
// Ignore-sender event
// ---------------------------------------------------------------------------

document.addEventListener('hunt:ignore-sender', (e) => {
  if (!e.detail || !e.detail.id) return
  state.ignore.add(String(e.detail.id).toLowerCase())
  saveIgnore(state.ignore)
  refreshFilterIndicator()
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
  state.wakeLock = createWakeLock()

  // Initialise map
  state.map = createHuntMap('map')
  state.map.setAttenuator(state.attenuatorDb)

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
  buildTargetSheet()

  // Wire controls
  el('connect-btn').addEventListener('click', () => {
    if (!state.connected) { state.wakeLock.enable(); connectAll() }
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
    if (!sheet.hidden) {
      el('settings-sheet').hidden = true
      el('target-sheet').hidden = true
      renderIgnoreList(el('ss-ignore-list'))
    }
  })

  el('settings-btn').addEventListener('click', () => {
    const sheet = el('settings-sheet')
    sheet.hidden = !sheet.hidden
    if (!sheet.hidden) {
      el('filter-sheet').hidden = true
      el('target-sheet').hidden = true
      updateManualFixStatus(el('ss-manfix-status'))
      refreshConnState()
    }
  })

  // Target chip tap → open the target dropdown
  el('target-chip').addEventListener('click', () => {
    const sheet = el('target-sheet')
    sheet.hidden = !sheet.hidden
    if (!sheet.hidden) {
      el('filter-sheet').hidden = true
      el('settings-sheet').hidden = true
      el('ts-clear').hidden = !state.filter.sender
      state.targetList.reset()
    }
  })

  // Retry location — re-starts the GPS watch (e.g. after the user grants the
  // permission the browser prompted for, or re-enables location services).
  el('splash-retry-gps').addEventListener('click', () => {
    state.gpsError = false
    refreshSplash()
    try { state.gps.stop() } catch (_) {}
    startGpsWatch()
  })

  // Reflect the initial filter state on the button (inactive at default)
  refreshFilterIndicator()
  // Reflect persisted attenuator/manual-fix state on the settings button
  refreshSettingsIndicator()
  refreshSplash()

  // Start background loops
  renderTick()
  drainLoop()
})

// Register the service worker so the app is installable. It is network-only
// (no caching — offline resilience lives in IndexedDB, see sw.js). Registration
// is non-fatal — the app works without it.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('[sw]', e))
  })
}
