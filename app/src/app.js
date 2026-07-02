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
import { compassHeading, bearingForHeading, nextCompassState } from './rotation.js'
import { parseVersion, isUpdateAvailable } from './update.js'

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
  // Manual override (Settings) — while true, MQTT stays disconnected and the
  // connect flow skips it entirely; un-pausing reconnects and the drain loop
  // catches up on whatever piled up in IndexedDB while paused.
  mqttPaused: false,
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
  attenuatorDb: loadAttenuator(),
  // Epoch ms of the most recent captured reception, for the "since last packet"
  // HUD timer. null until the first packet is heard this session.
  lastPacketAt: null,
  filter: { ...DEFAULT_FILTER },
  // Startup splash (see splash.js) — hides once the first GPS fix lands.
  hasFix: false,
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
// (attenuator non-zero). Call wherever state.attenuatorDb changes.
function refreshSettingsIndicator() {
  el('settings-btn').classList.toggle('active', isSettingsActive(state))
}

// Locate info readout — driven by huntmap.js's onLocate callback, fired every
// render tick with the single-hunter locate() result for the isolated sender
// (or null when nothing is isolated). Auto-fades 2s after first becoming
// visible for this isolation and stays hidden until re-triggered (see
// resetLocateFade(), called from the isolate-sender handler below) — it's a
// glance, not a permanent overlay blocking the map.
const LOCATE_FADE_MS = 2000
let locateFadeTimer = null
let locateAllowShow = false
function resetLocateFade() {
  locateAllowShow = true
  if (locateFadeTimer) { clearTimeout(locateFadeTimer); locateFadeTimer = null }
}
function updateLocateInfo(res) {
  const box = el('locate-info')
  if (!res) {
    box.hidden = true
    if (locateFadeTimer) { clearTimeout(locateFadeTimer); locateFadeTimer = null }
    return
  }
  if (!locateAllowShow) return // already auto-faded this isolation — stays hidden
  box.hidden = false
  if (!locateFadeTimer) {
    locateFadeTimer = setTimeout(() => {
      box.hidden = true
      locateAllowShow = false
      locateFadeTimer = null
    }, LOCATE_FADE_MS)
  }
  // AGENTS.md §7: any output implying a target's location must state it is
  // inferred from radio measurements, not GPS-tracked. Reuse the splash wording.
  const disclaimer = `<div class="lc-muted lc-disclaimer">${SPLASH_DISCLAIMER}</div>`
  if (!res.centroid) {
    box.innerHTML = `<h4>Locate</h4><div class="lc-muted">${res.inliers.length} point(s) — too few to estimate (need 3+, walk/drive around a bit).</div>`
      + disclaimer
    return
  }
  const s = res.stats
  const radius = s.searchRadiusM != null ? Math.round(s.searchRadiusM) + ' m' : '—'
  const enc = Math.round(s.encirclement * 100)
  const encHint = s.encirclement < 0.5 ? '<div class="lc-warn">One-sided — walk/drive around the estimate to tighten.</div>' : ''
  const strong = res.strongest ? ` · ★ strongest ${res.strongest.rssi ?? '—'} dBm` : ''
  box.innerHTML = `<h4>Locate</h4>`
    + `<div>${s.n} points · search radius ~${radius} · encircle ${enc}%${strong}</div>`
    + encHint
    + `<div class="lc-muted">● weighted estimate · ★ where you heard it loudest. From your own readings only.</div>`
    + disclaimer
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
  // Tips + disclaimer on every visible splash screen (intro, waiting-gps,
  // ble-error, gps-error) — previously waiting-gps only, so the position
  // disclaimer and hunting tips went unseen if the user never got that far.
  const showTips = s !== 'hidden'
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

  const fix = state.gps.latest()
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

// The actual redraw, split out from renderTick's timer-rescheduling so it can
// also be called on demand (e.g. right after ignoring a sender) without
// spawning a second parallel setTimeout chain alongside the running one.
async function drawOnce() {
  try {
    setDot('dot-mqtt', state.publisher != null && state.publisher.connected())
    const rows = await state.queue.takeAll()
    const now = Date.now()
    el('hud-since').textContent = sinceLabel(now, state.lastPacketAt)
    enrichNames(rows)
    if (state.map) {
      const fn = makeFilter({ ...state.filter, ignore: state.ignore })
      state.map.render(rows.filter((r) => fn(r, now)), state.filter.sender && state.filter.sender.id)
    }
    if (state.feed) {
      state.feed.render(feedItems(rows, { ignore: state.ignore, limit: 50 }), now, state.filter.sender && state.filter.sender.id)
    }
    if (state.targetList) state.targetList.render(rows, state.ignore, now, state.filter.sender && state.filter.sender.id)
  } catch (_) {
    // silent — render failure must not crash the loop
  }
}

async function renderTick() {
  await drawOnce()
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

// The top-bar Connect button and the Settings-sheet connect/disconnect button
// mirror the same connect/connecting/retry text, so every state change below
// is applied to both in one go.
function connectButtons() {
  return [el('connect-btn'), el('ss-conn-btn')].filter(Boolean)
}

// Creates and connects a fresh Publisher, replacing any prior instance. No-op
// if MQTT isn't configured. Called on BLE connect, and again when the user
// un-pauses MQTT from Settings while already connected.
function connectMqtt() {
  const cfg = getConfig()
  if (!cfg || !cfg.mqttUrl || !state.rxPubkey) return
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

async function connectAll() {
  connectButtons().forEach((btn) => { btn.disabled = true; btn.textContent = 'Connecting…' })
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

    // 4. MQTT publisher — non-fatal, and skipped entirely while paused (see
    // the Settings "Pause MQTT" toggle). Receptions are written to IndexedDB
    // first and the drain loop publishes them, so a slow or unreachable
    // broker must not fail the connect or tear down BLE. Connect in the
    // background; the render tick keeps dot-mqtt in sync with the live
    // publisher state.
    if (!state.mqttPaused) connectMqtt()

    // 5. Register frame handler
    state.transport.onFrame(processFrame)

    setHuntingChrome(true)
    el('discover-btn').disabled = false
    refreshConnState()
  } catch (e) {
    console.error('[connect]', e)
    connectButtons().forEach((btn) => { btn.textContent = 'Connect (retry)'; btn.disabled = false })
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
  const btn = el('ss-conn-btn')
  if (!btn) return
  const connected = state.connected
  // Only flip the connected/disconnected look here — "Connecting…" and
  // "Connect (retry)" text is set directly by connectAll()/disconnectAll()
  // via connectButtons(), and must not be clobbered by this no-op else branch.
  if (connected) {
    btn.textContent = 'Disconnect'
    btn.disabled = false
    btn.classList.remove('ss-connect')
    btn.classList.add('ss-disconnect')
  } else {
    btn.classList.remove('ss-disconnect')
    btn.classList.add('ss-connect')
  }
  el('ss-conn-name').textContent = state.name || '—'
  el('ss-conn-key').textContent = state.rxPubkey ? state.rxPubkey.slice(0, 12) + '…' : '—'
  el('ss-conn-sf').textContent = state.sf ? 'SF' + state.sf : '—'
  el('ss-conn-ble').textContent = connected ? 'Connected' : 'Not connected'
  el('ss-conn-mqtt').textContent = state.mqttPaused
    ? 'Paused'
    : (state.publisher && state.publisher.connected() ? 'Connected' : 'Not connected')

  const mqttBtn = el('ss-mqtt-pause-btn')
  if (mqttBtn) {
    if (state.mqttPaused) {
      mqttBtn.textContent = 'Resume MQTT'
      mqttBtn.classList.remove('ss-disconnect')
      mqttBtn.classList.add('ss-connect')
    } else {
      mqttBtn.textContent = 'Pause MQTT'
      mqttBtn.classList.remove('ss-connect')
      mqttBtn.classList.add('ss-disconnect')
    }
  }
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
    connectButtons().forEach((btn) => { btn.textContent = 'Connect'; btn.disabled = false })
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
      <label class="fs-row" id="fs-row-direct">
        <span>Direct only</span>
        <input type="checkbox" id="fs-direct-only" />
      </label>
      <label class="fs-row" id="fs-row-window">
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

  // Mark each row active when its own value differs from DEFAULT_FILTER,
  // mirroring the existing .fs-chip.active / .ss-manfix-active pattern —
  // the filter-button badge shows *something* differs, these show *what*.
  const syncDirectRow = () => el('fs-row-direct').classList.toggle('active', chk.checked !== DEFAULT_FILTER.directOnly)
  const syncWindowRow = () => el('fs-row-window').classList.toggle('active', (Number(sel.value) || null) !== DEFAULT_FILTER.windowMs)
  syncDirectRow(); syncWindowRow()

  chk.addEventListener('change', () => { state.filter.directOnly = chk.checked; syncDirectRow(); refreshFilterIndicator() })
  sel.addEventListener('change', () => { state.filter.windowMs = Number(sel.value) || null; syncWindowRow(); refreshFilterIndicator() })

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
    drawOnce()
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
      drawOnce()
    })
    row.appendChild(label)
    row.appendChild(rm)
    listEl.appendChild(row)
  }
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
        <button id="ss-conn-btn" class="ss-connect">Connect</button>
        <button id="ss-mqtt-pause-btn" class="ss-disconnect">Pause MQTT</button>
      </div>
      <div class="ss-radio-section">
        <h3>Radio</h3>
        <label class="ss-radio-row" id="ss-row-atten">
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
      <div class="ss-version-row">
        <span class="ss-version">core-hunter v${__APP_VERSION__}</span>
        <span id="ss-update-status" class="ss-update-status" hidden></span>
        <button id="ss-reload-btn" class="ss-reload" type="button">Reload</button>
      </div>
    </div>`

  // Reload drops the live BLE/MQTT session on purpose — it's the deliberate
  // way to pick up a new build now that pull-to-refresh is disabled (#132).
  el('ss-reload-btn').addEventListener('click', () => location.reload())

  el('ss-conn-btn').addEventListener('click', () => {
    if (state.connected) {
      disconnectAll()
      sheet.hidden = true
    } else {
      state.wakeLock.enable()
      connectAll()
    }
  })
  refreshConnState()

  el('ss-mqtt-pause-btn').addEventListener('click', () => {
    state.mqttPaused = !state.mqttPaused
    if (state.mqttPaused) {
      if (state.publisher) { state.publisher.end(); state.publisher = null }
      setDot('dot-mqtt', false)
    } else if (state.connected) {
      connectMqtt()
    }
    refreshConnState()
  })

  const atten = el('ss-atten')
  atten.value = String(state.attenuatorDb)
  const syncAttenRow = () => el('ss-row-atten').classList.toggle('active', (Number(atten.value) || 0) !== 0)
  syncAttenRow()
  atten.addEventListener('change', () => {
    state.attenuatorDb = Number(atten.value) || 0
    saveAttenuator(state.attenuatorDb)
    if (state.map) state.map.setAttenuator(state.attenuatorDb)
    syncAttenRow()
    refreshSettingsIndicator()
  })

  const chk = el('ss-theme')
  chk.checked = document.documentElement.dataset.theme === 'light'
  chk.addEventListener('change', () => {
    const theme = chk.checked ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    if (state.map) state.map.applyBasemap()
  })


  el('ss-close').addEventListener('click', () => { sheet.hidden = true })
}

// Fetch the deployed version (no-store so we always see the live file) and, if
// it's newer than the running build, surface an "update available" hint and
// flag the reload button. Failure (dev server, offline) is silent — the button
// still reloads on demand. Runs when the Settings sheet opens.
async function checkForUpdate() {
  const status = el('ss-update-status')
  const btn = el('ss-reload-btn')
  if (!status || !btn) return
  let latest = null
  try {
    latest = parseVersion(await (await fetch('/version.json', { cache: 'no-store' })).text())
  } catch { /* offline / dev server — leave as up-to-date */ }
  const stale = isUpdateAvailable(__APP_VERSION__, latest)
  status.textContent = stale ? `v${latest} available` : ''
  status.hidden = !stale
  btn.classList.toggle('ss-reload-update', stale)
}

// ---------------------------------------------------------------------------
// Layer-mode cycling
// ---------------------------------------------------------------------------

const LAYER_MODES = ['both', 'points', 'hex']
let layerIdx = 0

// One glyph per LAYER_MODES entry so the FAB reflects the active mode instead
// of always showing the "both" icon.
const LAYER_ICONS = {
  // Hexagon (the hex-heatmap glyph) with a point dot inside — visually
  // combines the other two modes' glyphs instead of reusing a generic
  // stacked-layers icon that doesn't read as "points + hex together".
  both: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <polygon points="10,2 17,6 17,14 10,18 3,14 3,6"/>
    <circle cx="10" cy="10" r="2.2" fill="currentColor" stroke="none"/>
  </svg>`,
  points: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <circle cx="10" cy="5" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="5" cy="14" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="14" r="1.8" fill="currentColor" stroke="none"/>
  </svg>`,
  hex: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <polygon points="10,2 17,6 17,14 10,18 3,14 3,6"/>
  </svg>`,
}

function updateLayerIcon() {
  const mode = LAYER_MODES[layerIdx]
  el('layer-toggle').innerHTML = LAYER_ICONS[mode]
  el('layer-toggle').setAttribute('aria-label', `Toggle layers (${mode})`)
}

// ---------------------------------------------------------------------------
// Compass mode (map follow toggle) — pwa only
// ---------------------------------------------------------------------------

// Google-Maps-style cycle (#116): static → tap → follow (auto-centre, north
// up) → tap → follow + heading rotation (map turns with the device) → tap →
// follow north-up again. Panning drops back to static; a two-finger rotate
// gesture takes over rotation manually and leaves heading mode.
const COMPASS_ICONS = {
  following: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <circle cx="10" cy="10" r="4"/>
    <line x1="10" y1="1" x2="10" y2="4"/>
    <line x1="10" y1="16" x2="10" y2="19"/>
    <line x1="1" y1="10" x2="4" y2="10"/>
    <line x1="16" y1="10" x2="19" y2="10"/>
  </svg>`,
  heading: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <polygon points="10,2 15,17 10,13.2 5,17" fill="currentColor" stroke="none"/>
  </svg>`,
  static: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <circle cx="10" cy="10" r="8"/>
    <polygon points="10,4 12.2,10 10,16 7.8,10" fill="currentColor" stroke="none"/>
  </svg>`,
}
const COMPASS_LABELS = {
  following: 'Rotate map with heading (compass mode)',
  heading: 'Back to north-up',
  static: 'Resume following (compass mode)',
}

let compassState = { follow: true, heading: false }
function compassGlyph({ follow, heading }) {
  return !follow ? 'static' : heading ? 'heading' : 'following'
}
function updateCompassIcon() {
  const glyph = compassGlyph(compassState)
  el('recenter-btn').innerHTML = COMPASS_ICONS[glyph]
  el('recenter-btn').setAttribute('aria-label', COMPASS_LABELS[glyph])
}

// Device-heading rotation. iOS only hands out DeviceOrientation after an
// explicit permission request from a user gesture, so enabling happens inside
// the compass-button click handler. Android's compass-grade reading comes
// from deviceorientationabsolute; iOS uses webkitCompassHeading (see
// rotation.js).
const ORIENTATION_EVENT = typeof window !== 'undefined' && 'ondeviceorientationabsolute' in window
  ? 'deviceorientationabsolute' : 'deviceorientation'
let orientationHandler = null
async function enableHeadingRotation() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false
    } catch { return false }
  }
  if (orientationHandler) return true
  orientationHandler = (e) => {
    const h = compassHeading(e)
    if (h != null && state.map) state.map.setBearing(bearingForHeading(h))
  }
  window.addEventListener(ORIENTATION_EVENT, orientationHandler)
  return true
}
function disableHeadingRotation() {
  if (!orientationHandler) return
  window.removeEventListener(ORIENTATION_EVENT, orientationHandler)
  orientationHandler = null
}

function cycleLayer() {
  layerIdx = (layerIdx + 1) % LAYER_MODES.length
  updateLayerIcon()
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
    resetLocateFade()
  } else {
    chip.textContent = 'No target'
    chip.classList.remove('active')
  }
  const clearBtn = el('ts-clear')
  if (clearBtn) clearBtn.hidden = !state.filter.sender
  el('locate-toggle-btn').hidden = !state.filter.sender
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
  drawOnce() // redraw now — don't wait up to 1s for the next render tick
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

  updateLayerIcon()
  el('layer-toggle').addEventListener('click', cycleLayer)

  // Compass button — always visible; cycles static → follow (north up) →
  // follow + heading rotation. See the compass-mode section above.
  updateCompassIcon()
  el('recenter-btn').addEventListener('click', async () => {
    if (!state.map) return
    const next = nextCompassState(compassState)
    if (next.heading && !compassState.heading) {
      // iOS permission prompt must run inside this click; denied → stay north-up
      if (!(await enableHeadingRotation())) next.heading = false
    }
    if (!next.heading && compassState.heading) disableHeadingRotation()
    if (!next.heading) state.map.setBearing(0)
    compassState.heading = next.heading
    if (next.follow && !compassState.follow) state.map.recenter() // fires onFollowChange → icon update
    else updateCompassIcon()
  })
  if (state.map) state.map.onFollowChange((follow) => {
    compassState.follow = follow
    if (!follow && compassState.heading) { compassState.heading = false; disableHeadingRotation() }
    updateCompassIcon()
  })
  // Manual two-finger rotation takes over from heading-follow (the map keeps
  // the gestured bearing; the button returns it to north-up).
  if (state.map) state.map.onGestureRotate(() => {
    if (!compassState.heading) return
    compassState.heading = false
    disableHeadingRotation()
    updateCompassIcon()
  })
  if (state.map) state.map.onLocate(updateLocateInfo)

  // Locate overlay toggle — visible only while a sender is isolated (see the
  // hunt:isolate-sender handler above). Defaults on; hiding it only hides the
  // rendered heatmap/markers/info-box, the estimate itself keeps computing.
  let locateVisible = true
  el('locate-toggle-btn').classList.add('active')
  el('locate-toggle-btn').addEventListener('click', () => {
    locateVisible = !locateVisible
    el('locate-toggle-btn').classList.toggle('active', locateVisible)
    if (state.map) state.map.setLocateVisible(locateVisible)
  })

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
      refreshConnState()
      checkForUpdate()
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

  // Tap outside an open sheet (on the map/backdrop) closes it — standard
  // bottom-sheet behaviour. Skips clicks on the sheet itself or on the button
  // that opens it (that click's own handler already ran and set hidden=false
  // by the time this bubbles to document, so excluding the toggle here stops
  // it from immediately re-closing what it just opened).
  const dismissableSheets = [
    { sheet: el('filter-sheet'), toggle: el('filter-btn') },
    { sheet: el('settings-sheet'), toggle: el('settings-btn') },
    { sheet: el('target-sheet'), toggle: el('target-chip') },
  ]
  document.addEventListener('click', (e) => {
    // A click can detach its own target mid-dispatch (the ignore-list Remove
    // button rebuilds the list via innerHTML) — a detached target fails every
    // contains() check and would wrongly close the sheet it was inside.
    if (!document.contains(e.target)) return
    for (const { sheet, toggle } of dismissableSheets) {
      if (sheet.hidden) continue
      if (sheet.contains(e.target) || toggle.contains(e.target)) continue
      sheet.hidden = true
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
