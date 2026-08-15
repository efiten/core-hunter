// core-hunter orchestrator — wires BLE → capture → IndexedDB queue → MQTT,
// renders the map FROM the IndexedDB store (resilient to BLE/MQTT drops),
// drives the HUD and controls.
//
// Pipeline per 0x88 frame:
//   parseFrame → code check → decodePacket → classifyReception
//   → GPS fix (drop if none, or if it is too inaccurate to place — #274)
//   → buildRecord → queue.add → updateHud
//
// Render tick (1s): non-destructive queue.takeAll() → makeFilter → map.render
// Drain tick (5s):  non-destructive queue.takeAll() → publish unpublished rows
//                   → add id to state.published Set (no queue.remove ever)

import { WebBluetoothTransport } from './transport.js'
import { parseFrame, PUSH_CODE_LOG_RX_DATA } from './frames.js'
import { initDecoder, decodePacket, channelNameFor, bytesToHex } from './decode.js'
import { classifyReception } from './meshpacket.js'
import { buildRecord, shouldCapture } from './capture.js'
import { Queue, RETENTION_MS, shouldContinueDraining, watermarkAfter } from './queue.js'
import { Publisher } from './publisher.js'
import { Gps, shouldNoticePoorFix, accuracyLabel, GPS_MAX_ACC_M } from './gps.js'
import { requestSelfInfo } from './selfinfo.js'
import { requestStatsCore, mvToPercent, isLowBattery } from './battery.js'
import { senderReadout } from './hudsender.js'
import { loadConfig, getConfig } from './config.js'
import { createHuntMap } from './huntmap.js'
import { VIEW_STATES, VIEW_LABELS, nextViewIndex, viewKey } from './maplayers.js'
import { makeFilter, isFilterActive, DEFAULT_FILTER, FILTER_PACKET_TYPES } from './filters.js'
import { isSettingsActive, loadAttenuator, loadSoundMode, loadViewIndex } from './settings.js'
import { sinceLabel } from './elapsed.js'
import { effectivePlotOffset, rssiToPct } from '../../web/shared/signal.js'
import { createReceptionLog } from './receptionlog.js'
import { createTargetList } from './targetlist.js'
import { resolveName, cachedName, resolvableKey } from './names.js'
import { buildDiscoverFrame, buildTracePathFrame } from './discover.js'
import { selectedRepeaterIds, senderList, expandSelection, idPrefix, selectionKeyFor } from './feed.js'
import { shouldAutoFire, staggerTargets } from './autoping.js'
import { createWakeLock } from './wakelock.js'
import { planResume } from './lifecycle.js'
import { splashState, SPLASH_COPY, SPLASH_DISCLAIMER, SPLASH_BASICS, SPLASH_CALLOUTS, SPLASH_TAGLINE, APP_NAME } from './splash.js'
import { nodePosNotice, nodePosKeyText, NODEPOS_GLANCE_MS } from './nodeposnotice.js'
import { drawableNodes } from './nodelayer.js'
import { calloutPosition, unionRect } from './calloutPosition.js'
import { compassHeading, bearingForHeading, nextCompassState, compassGlyph, resolveCourseHeading } from './rotation.js'
import { fabRingSvg } from './fabring.js'
import { SOUND_MODES, nextSoundMode, shouldPing, createSoundEngine } from './sound.js'
import { parseVersion, isUpdateAvailable } from './update.js'
import { fetchMe, postAuth, validateRegistration, buildRegisterBody, buildLoginBody, buildLinkBody, accountDisplayState, submitLabelForMode } from './auth.js'

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
// Loader lives in settings.js (guarded + unit-tested, #338).
function saveAttenuator(db) {
  try { localStorage.setItem('core-hunter-attenuator', String(db)) } catch (_) {}
}

// Sound mode (#145): off / rxtx / full, cycled by the sound FAB. Persisted
// like the attenuator; loader lives in settings.js (guarded + unit-tested, #338).
function saveSoundMode(mode) {
  try { localStorage.setItem('core-hunter-sound', mode) } catch (_) {}
}

// Row cap for the surfaces that are not window-scoped (the receptions log's
// "all" mode, the target list) — see docs/2026-07-22-retention-and-bounded-reads.md.
const RECENT_CAP = 2000

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
  rxLog: null,
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
  soundMode: loadSoundMode(),
  // Epoch ms of the most recent captured reception, for the "since last packet"
  // HUD timer. null until the first packet is heard this session.
  lastPacketAt: null,
  filter: { ...DEFAULT_FILTER },
  // Resolved name per selected target id (lowercased) — for the chip label
  // when exactly one target is selected (#178).
  senderLabels: new Map(),
  // Startup splash (see splash.js) — hides once the first GPS fix lands.
  hasFix: false,
  bleError: false,
  gpsError: false,
  // Onboarding re-opened via the "?" button after the splash has been dismissed.
  showOnboarding: false,
  // Epoch ms of the most recent GPS fix, used to detect a stalled watch on
  // return from background (#198). Distinct from lastPacketAt (BLE receptions).
  lastGpsFixAt: null,
  // Epoch ms when the page last became hidden during an active session, or
  // null when visible / not connected (#199).
  hiddenAt: null,
  // Most recent captured rows, cached from drawOnce so the auto-ping tick
  // (its own timer, outside the render loop) can derive selected-repeater
  // status without re-querying IndexedDB (#232, #233).
  lastRows: [],
  // Auto-ping (#233): toggled by the Discover FAB. lastLat/lastLon track the
  // position at the last fire, for the movement half of the fire gate.
  autoPing: { enabled: false, lastFireAt: null, lastLat: null, lastLon: null, timer: null, pendingPings: [] },
  // Companion battery (#281): polled periodically while connected, since it
  // doesn't arrive with each packet the way RSSI/SNR do.
  battery: { mv: null, timer: null, failures: 0 },
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id)

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

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

  // Who we heard it from — the origin, or "via <repeater>" for a relayed hop.
  const who = senderReadout(rec)
  const senderEl = el('hud-sender')
  senderEl.textContent = who.text
  senderEl.classList.toggle('via', who.viaRelay)

  // Thermal bar marker — continuous position from RSSI (calibration + attenuator)
  const offset = effectivePlotOffset(getConfig() && getConfig().rssiCalibrationOffset, state.attenuatorDb)
  const pct = rssiToPct(rec.rssi, offset)
  el('hud-bar-marker').style.left = pct + '%'
}

function setDot(id, on) {
  const d = el(id)
  if (on) d.classList.add('on')
  else d.classList.remove('on')
  // `.low` is declared after `.on` and is equally specific, so it kept the dot
  // coloured after the link dropped — a lit dot reading as "connected" to a
  // driver glancing down. Clearing it here rather than at the call site means
  // no future caller can reintroduce it (#281).
  if (!on) d.classList.remove('low')
}

// Companion battery (#281): the reading itself lives in Settings → Connection
// (raw voltage primary — no chemistry assumptions — with a rough Li-ion % hint),
// while a low battery rides the BLE status dot so it's catchable at a glance
// while driving.
function renderBattery() {
  const mv = state.battery.mv
  const row = el('ss-conn-battery')
  if (row) {
    const pct = mvToPercent(mv)
    // No percentage for a multi-cell pack: its endpoints are a firmware build
    // flag we cannot read over the wire, so volts is the only honest readout.
    row.textContent = !Number.isFinite(mv) ? '—'
      : pct === null ? `${(mv / 1000).toFixed(2)}V`
      : `${(mv / 1000).toFixed(2)}V (~${pct}%)`
    row.classList.toggle('ss-conn-low', isLowBattery(mv))
  }
  const dot = el('dot-ble')
  if (dot) dot.classList.toggle('low', state.connected && isLowBattery(mv))
}

const BATTERY_POLL_MS = 60000

// CMD_GET_STATS is v8+ firmware, and a companion that predates it (or has no
// stats handler at all) never answers — so every 60s poll would leave a 6s
// dangling promise for the whole session, silently. Give up after three
// consecutive misses rather than gating on fwVer: requestDeviceInfo has no
// caller today, so a version gate would mean an extra connect round-trip, and
// it would still not cover a v8+ board whose stats handler is absent.
const BATTERY_POLL_FAILURES_BEFORE_GIVING_UP = 3

function pollBattery() {
  if (!state.connected || !state.transport) return
  requestStatsCore(state.transport)
    .then((info) => {
      state.battery.failures = 0
      state.battery.mv = info.batteryMv
      renderBattery()
    })
    .catch(() => {
      // A transient BLE hiccup is retried; a companion that never answers is
      // not asked again until the next connect.
      state.battery.failures = (state.battery.failures || 0) + 1
      if (state.battery.failures >= BATTERY_POLL_FAILURES_BEFORE_GIVING_UP) stopBatteryPoll()
    })
}

function startBatteryPoll() {
  if (state.battery.timer) return
  state.battery.timer = setInterval(pollBattery, BATTERY_POLL_MS)
  pollBattery()
}

function stopBatteryPoll() {
  if (state.battery.timer) { clearInterval(state.battery.timer); state.battery.timer = null }
  state.battery.mv = null
  state.battery.failures = 0
  renderBattery()
}

// Light the filter pill's badge when the view is narrowed — either the filter
// differs from the default or the ignore-list (also a display filter) is
// non-empty. Also re-arms the locate readout glance (resetLocateFade) so the
// estimate re-shows whenever the user changes what they're looking at. Called
// wherever state.filter or state.ignore changes.
function refreshFilterState() {
  el('filter-pill').classList.toggle('active', isFilterActive(activeFilter()) || state.ignore.size > 0)
  resetLocateFade()
}

// Reflect the topbar popovers' open state on their triggers (aria-expanded
// drives the filter caret rotation + a11y). Called from the document click
// handler, which fires after every open/close path since all are click-driven.
function syncPopoverTriggers() {
  el('filter-pill').setAttribute('aria-expanded', String(!el('filter-sheet').hidden))
  el('target-chip').setAttribute('aria-expanded', String(!el('target-sheet').hidden))
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

// Populates the static onboarding copy (name, basics, callouts, disclaimer)
// from splash.js. Called once at startup, before the splash is first shown.
function initSplashContent() {
  el('splash-name').textContent = APP_NAME
  el('splash-tagline').textContent = SPLASH_TAGLINE
  el('splash-disclaimer').textContent = SPLASH_DISCLAIMER
  el('co-controls').textContent = SPLASH_CALLOUTS.controls
  el('co-menu').textContent = SPLASH_CALLOUTS.menu
  el('co-fabs').textContent = SPLASH_CALLOUTS.fabs
  el('splash-basics').replaceChildren(
    ...SPLASH_BASICS.map((b) => { const li = document.createElement('li'); li.textContent = b; return li })
  )
}

// Paused-capture banner (#199) — a brief glance shown after returning from a
// backgrounded gap long enough to matter (see shouldShowPausedBanner).
const PAUSED_BANNER_MS = 4000
let pausedBannerTimer = null
function showPausedBanner(hiddenForLabel) {
  showBannerText(`Capture paused ${hiddenForLabel} (backgrounded)`)
}

function showBannerText(text) {
  const box = el('bg-paused-banner')
  box.textContent = text
  box.hidden = false
  if (pausedBannerTimer) clearTimeout(pausedBannerTimer)
  pausedBannerTimer = setTimeout(() => { box.hidden = true; pausedBannerTimer = null }, PAUSED_BANNER_MS)
}

// Poor-GPS notice (#274) — reuses the paused banner, since "capture is not
// happening right now, and here is why" is exactly what that banner says.
let lastPoorFixNoticeAt = null
function noticePoorFix(fix) {
  const now = Date.now()
  if (!shouldNoticePoorFix(lastPoorFixNoticeAt, now)) return
  lastPoorFixNoticeAt = now
  showBannerText(`Capture paused — GPS fix ${accuracyLabel(fix)} (needs ≤${GPS_MAX_ACC_M} m)`)
}

// One-time first-connect hint (#199): screen-off/background pauses capture,
// so keep the screen on and the app foregrounded. Dismissible; never shown
// again once acknowledged.
const BG_HINT_SEEN_KEY = 'core-hunter-bg-hint-seen'
function maybeShowBgHint() {
  try { if (localStorage.getItem(BG_HINT_SEEN_KEY)) return } catch (_) { return }
  el('bg-hint').hidden = false
}
function dismissBgHint() {
  el('bg-hint').hidden = true
  try { localStorage.setItem(BG_HINT_SEEN_KEY, '1') } catch (_) {}
}

// Splash / onboarding overlay: shown until the first GPS fix (per splashState),
// and re-openable afterwards via the "?" button (state.showOnboarding). Call
// wherever hasFix/connected/bleError/gpsError/showOnboarding changes.
function refreshSplash() {
  const s = splashState(state)
  const reopened = state.showOnboarding && s === 'hidden'
  const visible = s !== 'hidden' || reopened
  el('splash').hidden = !visible
  document.body.classList.toggle('onboarding', visible)
  // Reopened mid-hunt: already connected, so no Connect CTA — show Close instead.
  el('splash-close').hidden = !reopened
  if (reopened) el('connect-btn').hidden = true
  el('splash-status').textContent = reopened ? '' : (SPLASH_COPY[s] || '')
  el('splash-retry-gps').hidden = s !== 'gps-error'
  // Only the reopened (post-connect "?") tour can be dismissed by tapping
  // outside the highlights (#216) — the pre-connect states must stay put
  // until the user actually connects/gets a fix.
  state.splashDismissible = reopened
  if (visible) positionCallouts()
}

// Anchors each onboarding callout to its real target element's current
// position (#216), instead of a hardcoded pixel offset, so placement stays
// correct across different screen sizes. Re-run on resize while visible.
function positionCallouts() {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const place = (id, targetRect, opts) => {
    const callout = el(id)
    if (!callout) return
    const { top, left } = calloutPosition(targetRect, viewport, callout.getBoundingClientRect(), opts)
    callout.style.top = `${top}px`
    callout.style.left = `${left}px`
  }
  const controls = el('topbar-controls')
  if (controls) place('co-controls', controls.getBoundingClientRect(), { side: 'below', align: 'left' })
  const menuBtn = el('settings-btn')
  if (menuBtn) place('co-menu', menuBtn.getBoundingClientRect(), { side: 'below', align: 'right' })
  const fabs = [el('layer-toggle'), el('discover-btn'), el('recenter-btn'), el('sound-toggle')].filter(Boolean)
  if (fabs.length) place('co-fabs', unionRect(fabs.map((b) => b.getBoundingClientRect())), { side: 'left' })
}

// (Re-)starts the GPS watch, e.g. on connect or after the user retries
// location from the splash. Shared so both call sites update state the same way.
function startGpsWatch() {
  state.gps.start(
    (fix) => {
      state.lastGpsFixAt = Date.now()
      if (state.map) state.map.setPosition(fix.lat, fix.lon)
      if (!state.hasFix) { state.hasFix = true; refreshSplash() }
      if (compassState.source === 'course') applyCourseHeading(fix.heading, fix.speed)
    },
    () => { state.gpsError = true; refreshSplash() }
  )
}

// ---------------------------------------------------------------------------
// Hide / return-to-visible (#198, #199)
// ---------------------------------------------------------------------------
// Screen-off and backgrounding aren't preventable on the web (#144) — this is
// best-effort hardening: minimise the gap on return rather than eliminate it.
// The resume runs whenever a connected session was backgrounded (keyed on
// hiddenAt), including while BLE is mid-reconnect (state.connected false) — that
// drop-while-backgrounded case is the one this targets. See planResume.

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (state.connected) state.hiddenAt = Date.now()
    return
  }
  const hiddenAt = state.hiddenAt
  state.hiddenAt = null
  const now = Date.now()
  const plan = planResume({ hiddenAt, connected: state.connected, lastGpsFixAt: state.lastGpsFixAt, now })
  if (!plan.run) return

  // BLE dropped while backgrounded → its backoff setTimeout was throttled; wake
  // it so a reconnect is attempted now instead of waiting out the (up to 30s) delay.
  if (plan.nudgeReconnect && state.transport && state.transport.nudgeReconnect) state.transport.nudgeReconnect()
  if (plan.restartGps) { state.gps.stop(); startGpsWatch() }
  drawOnce()      // don't wait up to 1s for the next render tick
  drainOnce()     // don't wait up to 5s for the next drain tick
  if (plan.showBanner) showPausedBanner(sinceLabel(now, hiddenAt))
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
  const fix = state.gps.latest()
  if (!shouldCapture(cls, fix)) {
    // A direct reception refused only because the fix is too poor is the one
    // case worth telling the user about — silently dropping receptions during
    // a drive is indistinguishable from the app being broken (#274).
    if (cls && cls.isDirect === true && fix) noticePoorFix(fix)
    return
  }

  const rec = buildRecord(frame, cls, fix, new Date().toISOString())
  rec._text = cls.text // local-only, for the popup; stripped before publish
  await state.queue.add(rec)
  state.lastPacketAt = Date.now()
  updateHud(rec)
  // Sound (#145): a morse dit per DIRECT reception inside the active filter
  // set — you hear exactly what the map plots, minus relayed traffic.
  if (shouldPing(rec, state.soundMode, makeFilter({ ...state.filter, ignore: state.ignore }), Date.now())) {
    sound.ping(rec.rssi, effectivePlotOffset(getConfig() && getConfig().rssiCalibrationOffset, state.attenuatorDb))
  }
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
    const now = Date.now()
    // The map shows the chosen window, so read exactly that (#230). A null
    // windowMs means "no time filter", which retention now bounds at 7 days.
    const windowMs = state.filter.windowMs ?? RETENTION_MS
    const windowRows = await state.queue.since(new Date(now - windowMs).toISOString())
    // The receptions log's "all" mode and the target list are not window-
    // scoped. They get a row-bounded read instead of the whole store: the log
    // caps at 200 rows and the list shows far fewer senders than RECENT_CAP
    // covers, so this is indistinguishable in practice at any realistic size.
    const rows = await state.queue.recent(RECENT_CAP)
    state.lastRows = rows
    el('hud-since').textContent = sinceLabel(now, state.lastPacketAt)
    // Enrich names on both the window and the recent rows to prevent mismatches
    // in the log and target list (BLOCKER 1 fix for PR #283)
    enrichNames(windowRows)
    enrichNames(rows)
    // activeFilter() from #267 (selection expanded to every id variant of the
    // node), applied to the windowed read from #230 — the map shows the chosen
    // window, not the whole retained store.
    const fn = makeFilter({ ...activeFilter(), ignore: state.ignore })
    const filteredRows = windowRows.filter((r) => fn(r, now))
    const selected = selectedSet()
    if (state.map) {
      state.map.render(filteredRows, selected)
    }
    // Receptions log (#130): filtered = the plotted set (one-to-one with the
    // map); all = every captured reception. The toggle is log-only.
    if (state.rxLog) state.rxLog.render(filteredRows, rows, now)
    if (state.targetList) state.targetList.render(rows, state.ignore, now, selected)
    updateDiscoverBtnVisual()
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
// Dedup via a watermark persisted in IndexedDB: every row at or below it has
// reached the broker. It survives a restart, so a relaunch no longer
// re-publishes the whole store. If publish fails the watermark stops there and
// the remaining rows are retried on the next drain.
// Rows are removed from IndexedDB only by retention (pruneOnce), and only once
// they are at or below the watermark — see docs/2026-07-22-retention-decision.md.

// The actual publish pass, split out from drainLoop's timer-rescheduling so it
// can also be called on demand (e.g. right after returning from background)
// without spawning a second parallel setTimeout chain alongside the running one.
// In-flight guard: the on-demand drain (from onVisibilityChange) can otherwise
// run concurrently with the periodic drainLoop, and since a row is only marked
// published after publish() resolves, two overlapping passes could each publish
// the same row (a redundant MQTT message — backend dedups on raw+rx_at).
let draining = false
async function drainOnce() {
  if (draining) return
  if (!(state.publisher && state.publisher.connected() && state.rxPubkey)) return
  draining = true
  try {
    const startedAt = Date.now()
    let watermark = await state.queue.getWatermark()
    // Keep taking batches until the store is drained or the budget is spent
    // (#230). One batch per tick would leave a 50k backlog over half an hour
    // behind; see shouldContinueDraining.
    for (;;) {
      const rows = await state.queue.unpublishedFrom(watermark)
      const outcomes = []
      for (const r of rows) {
        try {
          await state.publisher.publish(state.rxPubkey, r, state.name)
          outcomes.push({ id: r.id, ok: true })
        } catch (_) {
          // Publish failed. Stop here rather than skipping ahead — the rest is
          // retried next cycle. How far the watermark may move is
          // watermarkAfter's decision, not this loop's.
          outcomes.push({ id: r.id, ok: false })
          break
        }
      }
      const failed = outcomes.some((o) => !o.ok)
      const last = watermarkAfter(watermark, outcomes)
      if (last > watermark) {
        await state.queue.setWatermark(last)
        console.debug('[drain] published through id', last)
        watermark = last
      }
      if (failed) break
      if (!shouldContinueDraining({ batchSize: rows.length, elapsedMs: Date.now() - startedAt })) break
    }
    await pruneOnce()
  } catch (_) {
    // queue read failed — retry next cycle
  } finally {
    draining = false
  }
}

// Retention (#230): drop receptions past RETENTION_MS, but only ones the broker
// already has — "all receptions go to MQTT" outranks the age cap, so an offline
// phone keeps everything until it drains. Hourly; the store only grows slowly.
let lastPrune = 0
async function pruneOnce() {
  const now = Date.now()
  if (now - lastPrune < 3600_000) return
  lastPrune = now
  const cutoff = new Date(now - RETENTION_MS).toISOString()
  const removed = await state.queue.prune(cutoff, await state.queue.getWatermark())
  if (removed > 0) console.debug('[prune] removed', removed, 'published record(s) past retention')
}

async function drainLoop() {
  await drainOnce()
  setTimeout(drainLoop, 5000)
}

// ---------------------------------------------------------------------------
// Discover + auto-ping (#232, #233)
// ---------------------------------------------------------------------------

function sendDiscover() {
  if (!state.connected || !state.transport) return
  const tag = crypto.getRandomValues(new Uint8Array(4))
  state.transport.send(buildDiscoverFrame(tag)).catch(() => {})
}

// One byte-prefix hash per hop, same convention as Discover's
// DISCOVER_PREFIX_ONLY — first byte of the target's pubkey/id.
function sendTracePing(id) {
  if (!state.connected || !state.transport) return false
  const hashByte = parseInt(String(id).slice(0, 2), 16)
  if (Number.isNaN(hashByte)) return false
  const tag = crypto.getRandomValues(new Uint32Array(1))[0]
  state.transport.send(buildTracePathFrame(tag, 0, [hashByte])).catch(() => {})
  return true
}

// Brief pulse feedback (#232) on the Discover FAB every time a ping actually
// goes out — retriggerable via the remove/reflow/add dance so back-to-back
// fires each get a fresh animation instead of the class no-op'ing.
function pulseDiscoverBtn() {
  const btn = el('discover-btn')
  if (!btn) return
  btn.classList.remove('pulse')
  void btn.offsetWidth
  btn.classList.add('pulse')
}

// Currently-selected targets that behave as repeaters, per the most recent
// cached row for each (#233's "if the selected list contains repeaters").
function selectedRepeaterTargets() {
  const selected = selectedSet()
  if (!selected) return []
  return selectedRepeaterIds(state.lastRows, selected)
}

// Steady FAB appearance: off / auto-discover-only / auto-discover+target-ping
// — the third is automatic (driven by selection), not a separate tap state.
function updateDiscoverBtnVisual() {
  const btn = el('discover-btn')
  if (!btn) return
  const targeting = state.autoPing.enabled && selectedRepeaterTargets().length > 0
  btn.classList.toggle('auto-on', state.autoPing.enabled)
  btn.classList.toggle('auto-target', targeting)
  btn.setAttribute('aria-label', !state.autoPing.enabled ? 'Discover'
    : targeting ? 'Auto-discover + target ping: on' : 'Auto-discover: on')
}

// Runs on its own timer (independent of the 1s render tick) so auto-ping
// keeps a consistent cadence regardless of render load.
function autoPingTick() {
  if (!state.autoPing.enabled || !state.connected) return
  const fix = state.gps.latest()
  const now = Date.now()
  const fire = shouldAutoFire({
    lastFireAt: state.autoPing.lastFireAt,
    lastLat: state.autoPing.lastLat,
    lastLon: state.autoPing.lastLon,
    now,
    lat: fix ? fix.lat : null,
    lon: fix ? fix.lon : null,
    // Skip this cycle while the previous one is still draining (#253) — see
    // shouldAutoFire. Each timer removes its own handle below, so the length
    // is the count still queued rather than a running total.
    pendingTargets: state.autoPing.pendingPings.length,
  })
  if (!fire) return
  state.autoPing.lastFireAt = now
  if (fix) { state.autoPing.lastLat = fix.lat; state.autoPing.lastLon = fix.lon }
  sendDiscover()
  pulseDiscoverBtn()
  sound.txBlip('discover')   // audio twin of the FAB pulse (#145)
  // Each staggered trace-ping is also a real transmission — pulse the FAB and
  // sound the cue for it too, but only if the ping actually succeeds (#254).
  // The tx cue follows the same rule as the pulse: it must mean "a frame went
  // out", not "a timer fired", or it lies after a BLE drop.
  for (const { id, delayMs } of staggerTargets(selectedRepeaterTargets())) {
    const handle = setTimeout(() => {
      const i = state.autoPing.pendingPings.indexOf(handle)
      if (i !== -1) state.autoPing.pendingPings.splice(i, 1)
      if (sendTracePing(id)) { pulseDiscoverBtn(); sound.txBlip('trace') }
    }, delayMs)
    state.autoPing.pendingPings.push(handle)
  }
}

function stopAutoPing() {
  state.autoPing.enabled = false
  if (state.autoPing.timer) { clearInterval(state.autoPing.timer); state.autoPing.timer = null }
  for (const handle of state.autoPing.pendingPings) clearTimeout(handle)
  state.autoPing.pendingPings = []
  updateDiscoverBtnVisual()
}

// Tapping the FAB toggles auto-discover on/off — no separate manual one-shot;
// turning on fires immediately rather than waiting for the first tick.
function toggleAutoPing() {
  if (!state.connected) return
  if (state.autoPing.enabled) { stopAutoPing(); return }
  state.autoPing.enabled = true
  state.autoPing.lastFireAt = null
  if (!state.autoPing.timer) state.autoPing.timer = setInterval(autoPingTick, 1000)
  autoPingTick()
  updateDiscoverBtnVisual()
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
      if (!on) {
        state.connected = false
        // A spontaneous drop never reaches disconnectAll/stopBatteryPoll, so
        // without this Settings keeps showing the last voltage read before the
        // link died, indefinitely and with no sign it is stale.
        state.battery.mv = null
        renderBattery()
      }
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
    maybeShowBgHint()
    startBatteryPoll()
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
}

// Fetch the current account/session and reflect it in the Account section:
// status label + which of Register/Login/Logout/Link are visible. Called
// whenever the Settings sheet opens (and once on first build).
async function refreshAccount() {
  const me = await fetchMe()
  state.account = me
  const s = accountDisplayState(me, state.rxPubkey)
  el('ss-account-status').textContent = s.label
  el('ss-acc-register').hidden = !s.showRegister
  el('ss-acc-login').hidden = !s.showLogin
  el('ss-acc-logout').hidden = !s.showLogout
  el('ss-acc-link').hidden = !s.showLink
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
  renderBattery()
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
  state.rxPubkey = ''
  state.sf = null
  el('discover-btn').disabled = true
  stopAutoPing()
  stopBatteryPoll()

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
        <h3>Ignored senders</h3>
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

  chk.addEventListener('change', () => { state.filter.directOnly = chk.checked; syncDirectRow(); refreshFilterState() })
  sel.addEventListener('change', () => {
    state.filter.windowMs = Number(sel.value) || null
    if (state.map) state.map.setTimeWindow(state.filter.windowMs)
    syncWindowRow(); refreshFilterState()
  })

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
    refreshFilterState()
  })

  renderIgnoreList(el('ss-ignore-list'))
  el('ss-ignore-clear').addEventListener('click', () => {
    state.ignore.clear()
    saveIgnore(state.ignore)
    renderIgnoreList(el('ss-ignore-list'))
    refreshFilterState()
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
    // Whole-row tap toggles this sender in the target set; the sheet stays open
    // so several can be picked in a row (#178).
    onSelect: (id, label, ids) => {
      document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id, label, ids, toggle: true } }))
    },
  })

  el('ts-clear').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: null }))
  })

  el('ts-close').addEventListener('click', () => { sheet.hidden = true })
}

function renderIgnoreList(listEl) {
  listEl.innerHTML = ''
  if (state.ignore.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'ss-ignore-empty'
    empty.textContent = 'No ignored senders.'
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
      refreshFilterState()
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
    <div class="settings-page-inner">
      <div class="sheet-head">
        <div class="ss-tabs" role="tablist" aria-label="Settings sections">
          <button type="button" class="ss-tab active" id="ss-tab-settings" role="tab" aria-selected="true" aria-controls="ss-panel-settings">Settings</button>
          <button type="button" class="ss-tab" id="ss-tab-about" role="tab" aria-selected="false" aria-controls="ss-panel-about">About</button>
        </div>
        <button class="sheet-close" id="ss-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
      <div class="ss-panel active" id="ss-panel-settings" role="tabpanel" aria-labelledby="ss-tab-settings">
      <div class="ss-conn-section">
        <h3>Connection</h3>
        <dl class="ss-conn-status">
          <dt>Companion</dt><dd id="ss-conn-name">—</dd>
          <dt>Pubkey</dt><dd id="ss-conn-key">—</dd>
          <dt>Spreading factor</dt><dd id="ss-conn-sf">—</dd>
          <dt>Battery</dt><dd id="ss-conn-battery">—</dd>
          <dt>BLE</dt><dd id="ss-conn-ble">—</dd>
          <dt>MQTT</dt><dd id="ss-conn-mqtt">—</dd>
        </dl>
        <button id="ss-conn-btn" class="ss-connect">Connect</button>
        <button id="ss-mqtt-pause-btn" class="ss-disconnect">Pause MQTT</button>
      </div>
      <div class="ss-account-section">
        <h3>Account</h3>
        <p id="ss-account-status" class="ss-acc-status">Not logged in</p>
        <div class="ss-acc-actions">
          <div class="ss-acc-mode-tabs" role="tablist" aria-label="Register or log in">
            <button id="ss-acc-register" class="ss-acc-mode-tab" type="button" role="tab">Register</button>
            <button id="ss-acc-login" class="ss-acc-mode-tab" type="button" role="tab">Log in</button>
          </div>
          <button id="ss-acc-link" type="button" hidden>Link this companion</button>
          <button id="ss-acc-logout" type="button" hidden>Log out</button>
        </div>
        <form id="ss-acc-form" class="ss-acc-form" hidden>
          <input id="ss-acc-username" type="text" placeholder="Username" autocomplete="username" />
          <input id="ss-acc-password" type="password" placeholder="Password (min 10 chars)" autocomplete="current-password" />
          <input id="ss-acc-email" type="email" placeholder="Email (optional — reset only)" autocomplete="email" hidden />
          <label id="ss-acc-remember-row" hidden><input id="ss-acc-remember" type="checkbox" /> Remember me</label>
          <div id="ss-acc-form-actions" class="ss-acc-form-actions">
            <button id="ss-acc-submit" class="ss-connect" type="submit">Submit</button>
            <button id="ss-acc-cancel" type="button">Cancel</button>
          </div>
        </form>
        <p id="ss-acc-msg" class="ss-acc-msg" hidden></p>
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
      <label class="ss-theme-row">
        <input type="checkbox" id="ss-theme" />
        Light theme
      </label>
      <div class="ss-version-row">
        <span id="ss-update-status" class="ss-update-status" hidden></span>
        <button id="ss-reload-btn" class="ss-reload" type="button">Reload</button>
      </div>
      </div>
      <div class="ss-panel" id="ss-panel-about" role="tabpanel" aria-labelledby="ss-tab-about" hidden>
        <div class="ss-about-brand">
          <span class="ss-about-mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.6"/><path d="M10 10l5-3.2"/>
            </svg>
          </span>
          <div>
            <div class="ss-about-name">${APP_NAME}</div>
            <div class="ss-version">v${__APP_VERSION__}</div>
          </div>
        </div>
        <p class="ss-about-desc">Locate MeshCore nodes by their radio signal. Your logged receptions build a shared coverage map. Built by amateur-radio operators.</p>
        <nav class="ss-about-links">
          <button type="button" id="ss-about-howto">
            <span class="ss-link-title">How it works</span>
            <span class="ss-link-desc">Re-open the walkthrough of the map, controls and what gets logged.</span>
          </button>
          <a href="https://map.mesh-hunter.eu" target="_blank" rel="noopener">
            <span class="ss-link-title">Shared coverage map</span>
            <span class="ss-link-desc">Where MeshCore nodes have been heard, pooled from every hunter.</span>
          </a>
          <a href="https://mesh-hunter.eu" target="_blank" rel="noopener">
            <span class="ss-link-title">mesh-hunter.eu</span>
            <span class="ss-link-desc">The project — what it is and how to take part.</span>
          </a>
          <a href="https://github.com/efiten/core-hunter" target="_blank" rel="noopener">
            <span class="ss-link-title">Source &amp; issues on GitHub</span>
            <span class="ss-link-desc">Browse the code, report a bug, or request a feature.</span>
          </a>
        </nav>
        <p class="ss-about-disclaimer">${SPLASH_DISCLAIMER}</p>
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

  // Tab switching (#203): one panel at a time. Both panels stay in the DOM so
  // each keeps its own scroll position independently.
  function selectTab(which) {
    for (const k of ['settings', 'about']) {
      const on = k === which
      el('ss-tab-' + k).classList.toggle('active', on)
      el('ss-tab-' + k).setAttribute('aria-selected', String(on))
      el('ss-panel-' + k).classList.toggle('active', on)
      el('ss-panel-' + k).hidden = !on
    }
  }
  el('ss-tab-settings').addEventListener('click', () => selectTab('settings'))
  el('ss-tab-about').addEventListener('click', () => selectTab('about'))

  // Replaces the old topbar "?" button (#281): closes the sheet so the
  // walkthrough it re-opens isn't hidden behind it.
  el('ss-about-howto').addEventListener('click', () => {
    el('settings-sheet').hidden = true
    state.showOnboarding = true
    refreshSplash()
  })

  let accFormMode = null // 'login' | 'register'

  function openAccForm(mode) {
    accFormMode = mode
    el('ss-acc-form').hidden = false
    el('ss-acc-email').hidden = mode !== 'register'
    el('ss-acc-remember-row').hidden = mode !== 'login'
    el('ss-acc-msg').hidden = true
    el('ss-acc-username').value = ''
    el('ss-acc-password').value = ''
    el('ss-acc-email').value = ''
    el('ss-acc-submit').textContent = submitLabelForMode(mode)
    el('ss-acc-register').classList.toggle('active', mode === 'register')
    el('ss-acc-login').classList.toggle('active', mode === 'login')
  }
  function closeAccForm() {
    el('ss-acc-form').hidden = true
    accFormMode = null
    el('ss-acc-register').classList.remove('active')
    el('ss-acc-login').classList.remove('active')
  }
  function accMsg(text, ok) {
    const m = el('ss-acc-msg'); m.textContent = text; m.hidden = false
    m.classList.toggle('ok', !!ok)
  }

  el('ss-acc-login').addEventListener('click', () => openAccForm('login'))
  el('ss-acc-register').addEventListener('click', () => {
    if (!state.connected || !state.rxPubkey) {
      accMsg('Connect a companion first — registration links it to your account.')
      el('ss-acc-msg').hidden = false
      return
    }
    openAccForm('register')
  })
  el('ss-acc-cancel').addEventListener('click', closeAccForm)

  // Keep the submit button reachable once the on-screen keyboard opens — the
  // settings sheet is a full-page scrollable overlay with no viewport-resize
  // handling, so the keyboard can otherwise cover the actions/error row.
  for (const id of ['ss-acc-username', 'ss-acc-password']) {
    el(id).addEventListener('focus', () => {
      setTimeout(() => el('ss-acc-form-actions').scrollIntoView({ block: 'nearest' }), 300)
    })
  }

  el('ss-acc-link').addEventListener('click', async () => {
    if (!state.rxPubkey) return
    const short = state.rxPubkey.slice(0, 12) + '…'
    accMsg(`Linking companion ${short}…`)
    const r = await postAuth('/api/auth/link-companion', buildLinkBody(state.rxPubkey))
    if (r.ok) { await refreshAccount(); accMsg('Companion linked.', true) }
    else if (r.status === 401) accMsg('Log in first.')
    else accMsg('Linking failed — check your connection.')
  })

  el('ss-acc-logout').addEventListener('click', async () => {
    const r = await postAuth('/api/auth/logout', {})
    if (r.ok) {
      closeAccForm()
      await refreshAccount()
      accMsg('Logged out.', true)
    } else {
      accMsg('Logout failed — check your connection.')
    }
  })

  el('ss-acc-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const username = el('ss-acc-username').value.trim()
    const password = el('ss-acc-password').value

    if (accFormMode === 'login') {
      const remember = el('ss-acc-remember').checked
      const r = await postAuth('/api/auth/login', buildLoginBody({ username, password, remember }))
      if (r.ok) { closeAccForm(); await refreshAccount() }
      else if (r.status === 401) accMsg('Wrong username or password.')
      else if (r.status === 403) accMsg('This account is disabled.')
      else if (r.status === 429) accMsg('Too many attempts — wait a minute.')
      else accMsg('Login failed — check your connection.')
      return
    }
    if (accFormMode === 'register') {
      const email = el('ss-acc-email').value
      const errs = validateRegistration({ username, password, companionPubkey: state.rxPubkey })
      if (errs.length) {
        accMsg(errs.includes('password_too_short') ? 'Password must be at least 10 characters.'
             : errs.includes('username_invalid') ? 'Enter a username.'
             : 'Connect a companion first.')
        return
      }
      const r = await postAuth('/api/auth/register',
        buildRegisterBody({ username, password, email, companionPubkey: state.rxPubkey }))
      if (r.ok) { closeAccForm(); await refreshAccount(); accMsg('Account created — logged in.', true) }
      else if (r.status === 409) accMsg('That username is taken.')
      else if (r.status === 429) accMsg('Too many attempts — wait a minute.')
      else accMsg('Registration failed — check your connection.')
      return
    }
  })

  refreshAccount()
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
// View cycling — layer mode + 2D/3D merged into one 5-state FAB (#258)
// ---------------------------------------------------------------------------
// Was two FABs (layer-toggle: both/points/hex · mode3d-toggle: 2D/3D, #147
// phase 2) — merged into VIEW_STATES' 5-state cycle (maplayers.js) to free a
// FAB slot. Persisted like the sound mode; unknown/corrupt storage falls back
// to both/2D (index 1), the app's cold default — see loadViewIndex in
// settings.js (guarded + unit-tested, #338).

function saveViewIndex(i) {
  try { localStorage.setItem('core-hunter-view', viewKey(VIEW_STATES[i])) } catch (_) {}
}

let viewIdx = loadViewIndex()

// One glyph per VIEW_STATES entry. The 2D glyphs are the original flat layer
// icons; the 3D glyphs are drawn isometrically so 2D vs 3D reads at a glance
// without a separate icon, not just the tilted map behind the FAB.
const VIEW_ICONS = {
  points2d: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <circle cx="10" cy="5" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="5" cy="14" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="14" r="1.8" fill="currentColor" stroke="none"/>
  </svg>`,
  // Hexagon (the hex-heatmap glyph) with a point dot inside — visually
  // combines the other two modes' glyphs instead of reusing a generic
  // stacked-layers icon that doesn't read as "points + hex together".
  both2d: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <polygon points="10,2 17,6 17,14 10,18 3,14 3,6"/>
    <circle cx="10" cy="10" r="2.2" fill="currentColor" stroke="none"/>
  </svg>`,
  // Isometric hex-prism outline — reads as the extruded hex bars this state
  // draws (formerly the 2D/3D FAB's own "3D" glyph).
  hex3d: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 2l7 4v8l-7 4-7-4V6z"/>
    <path d="M3 6l7 4 7-4M10 10v8"/>
  </svg>`,
  // Three standing pillars of varying height on a ground line — the 3D twin
  // of points2d's three flat dots (#308's pillar markers, one per reception).
  points3d: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <line x1="3" y1="16" x2="17" y2="16" stroke-width="1.2" opacity="0.6"/>
    <line x1="6" y1="16" x2="6" y2="10"/>
    <line x1="10" y1="16" x2="10" y2="6"/>
    <line x1="14" y1="16" x2="14" y2="11"/>
    <circle cx="6" cy="10" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="10" cy="6" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="14" cy="11" r="1.3" fill="currentColor" stroke="none"/>
  </svg>`,
  // Faded hex-prism outline with one solid pillar standing inside — the 3D
  // twin of both2d's hex-outline-plus-center-dot.
  both3d: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    <path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z" opacity="0.55"/>
    <line x1="10" y1="17" x2="10" y2="8" stroke-width="1.6"/>
    <circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none"/>
  </svg>`,
}
function updateViewIcon() {
  const key = viewKey(VIEW_STATES[viewIdx])
  // Ring shows the cycle position (#259) — 5 states, filled up through viewIdx.
  // `|| ''` so a state added without an icon degrades to a bare ring rather
  // than writing the string "undefined" into the button.
  el('layer-toggle').innerHTML = fabRingSvg(viewIdx, VIEW_STATES.length) + (VIEW_ICONS[key] || '')
  el('layer-toggle').setAttribute('aria-label', `Toggle view (${VIEW_LABELS[key]})`)
}

function cycleView() {
  viewIdx = nextViewIndex(viewIdx)
  saveViewIndex(viewIdx)
  updateViewIcon()
  const { mode, mode3D } = VIEW_STATES[viewIdx]
  if (state.map) state.map.setView(mode, mode3D)
}

// ---------------------------------------------------------------------------
// Node-position layer (#197)
// ---------------------------------------------------------------------------

// Registry nodes that know their own position, fetched once per session and
// filtered to the viewport client-side (AGENTS.md §7: no per-packet API calls).
// The bulk endpoint only exists on our own nameresolver — third-party CoreScope
// resolvers implement the resolve contract but not this — so a 404 or a network
// error just means that resolver contributes nothing.
let nodePosOn = false, nodePosLoaded = false, nodePosAttempted = false, nodePosCount = 0

// Single-flight: toggling the layer off and on during a slow fetch used to
// start a second concurrent load, and a failing second pass would clobber a
// successful first one — leaving an empty layer under a "no registry data"
// line that was not true.
let nodePosInFlight = null
function loadNodePositions() {
  if (nodePosLoaded) return Promise.resolve()
  if (!nodePosInFlight) nodePosInFlight = fetchNodePositions().finally(() => { nodePosInFlight = null })
  return nodePosInFlight
}

async function fetchNodePositions() {
  const cfg = getConfig()
  const resolvers = (cfg && cfg.resolvers) || []
  const byPubkey = new Map()
  let anyAnswered = false
  for (const r of resolvers) {
    try {
      const url = r.url.replace(/\/resolve$/, '/positions')
      const res = await fetch(url)
      if (!res.ok) continue
      const j = await res.json()
      anyAnswered = true
      for (const n of drawableNodes(j.nodes || [])) {
        byPubkey.set(String(n.pubkey).toLowerCase(), n)
      }
    } catch (_) {
      // resolver unreachable or has no bulk endpoint — skip it
    }
  }
  // Only latch when something actually answered. A run where every resolver
  // was unreachable is a transient failure, not an empty registry: latching it
  // would pin the empty layer for the whole session, with no retry when
  // connectivity comes back.
  nodePosLoaded = anyAnswered
  nodePosAttempted = true
  nodePosCount = byPubkey.size
  if (state.map) state.map.setNodePositions([...byPubkey.values()])
}

// §7: this layer implies node locations. The one-line ▲/● key is on screen for
// as long as the layer is — a popup-only note would not satisfy it — while the
// full disclaimer prose is a 2s glance so it stops covering the HUD (#306).
// Which of the two may fade is decided in nodeposnotice.js, under test.
let nodePosFadeTimer = null

function applyNodePosNotices({ glanceExpired = false } = {}) {
  const { note, key } = nodePosNotice({ on: nodePosOn, glanceExpired })
  const noteEl = el('nodepos-note')
  const keyEl = el('nodepos-key')
  noteEl.textContent = SPLASH_DISCLAIMER
  noteEl.hidden = !note
  // registryEmpty is only meaningful once the fetch has finished; until then
  // the glyph key is the honest line, since positions may still arrive (#307).
  // "Nothing came back" and "nobody answered" both mean nothing can be drawn,
  // and both are only knowable once a load attempt has finished.
  keyEl.textContent = nodePosKeyText({ registryEmpty: nodePosAttempted && nodePosCount === 0 })
  keyEl.hidden = !key
}

async function toggleNodePositions() {
  nodePosOn = !nodePosOn
  const btn = el('nodepos-toggle')
  btn.classList.toggle('on', nodePosOn)
  btn.setAttribute('aria-pressed', String(nodePosOn))
  // Cleared on every entry, so rapid toggling can't have a stale timer hide
  // the glance two seconds into a later activation.
  if (nodePosFadeTimer) { clearTimeout(nodePosFadeTimer); nodePosFadeTimer = null }
  applyNodePosNotices()
  if (nodePosOn) {
    nodePosFadeTimer = setTimeout(() => {
      nodePosFadeTimer = null
      applyNodePosNotices({ glanceExpired: true })
    }, NODEPOS_GLANCE_MS)
  }
  if (nodePosOn) {
    await loadNodePositions()
    // The count is only known after the fetch, so the key is re-applied here:
    // "no registry data" and "worked, nothing in view" must not look alike.
    applyNodePosNotices({ glanceExpired: nodePosFadeTimer === null })
  }
  if (state.map) state.map.setNodeLayerVisible(nodePosOn)
}

// ---------------------------------------------------------------------------
// Sound modes (#145, collapsed to 3 states per #255) — off / rxtx / full,
// cycled by the sound FAB
// ---------------------------------------------------------------------------

const sound = createSoundEngine()

// Icon shows the CURRENT mode, same convention as the layer/2D-3D FABs:
// slashed speaker (off), speaker + one wave (rxtx — pings/tx only), music
// note (full — soundbed + generative music + pings/tx; a radio-station icon
// is a planned addition once #256 lands).
const SOUND_SPEAKER = '<path d="M4 8h3l4-3v10l-4-3H4z"/>'
const SOUND_ICONS = {
  off: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    ${SOUND_SPEAKER}<line x1="13.5" y1="7.5" x2="17.5" y2="12.5"/><line x1="17.5" y1="7.5" x2="13.5" y2="12.5"/>
  </svg>`,
  rxtx: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    ${SOUND_SPEAKER}<path d="M13.5 7.5a4.2 4.2 0 0 1 0 5"/>
  </svg>`,
  full: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    <path d="M7 15.5V5l9-1.5V14"/><circle cx="5" cy="15.5" r="2"/><circle cx="14" cy="14" r="2"/>
  </svg>`,
}
const SOUND_LABELS = {
  off: 'Toggle sound (off)',
  rxtx: 'Toggle sound (reception + transmit cues only)',
  full: 'Toggle sound (soundbed + music + reception/transmit cues)',
}

function updateSoundIcon() {
  const btn = el('sound-toggle')
  // Ring shows the cycle position (#259), same as the layer and compass FABs —
  // off/rxtx/full is a 3-state cycle, which is exactly what fabring.js says
  // earns one. Without it this FAB was the one multi-state control whose next
  // tap you could not predict.
  const idx = SOUND_MODES.indexOf(state.soundMode)
  btn.innerHTML = fabRingSvg(idx, SOUND_MODES.length) + SOUND_ICONS[state.soundMode]
  btn.setAttribute('aria-label', SOUND_LABELS[state.soundMode])
  btn.classList.toggle('on', state.soundMode !== 'off')
}

function cycleSound() {
  state.soundMode = nextSoundMode(state.soundMode)
  saveSoundMode(state.soundMode)
  sound.setMode(state.soundMode)   // the FAB tap is the user gesture Web Audio needs
  updateSoundIcon()
}

// ---------------------------------------------------------------------------
// Compass mode (map follow toggle) — pwa only
// ---------------------------------------------------------------------------

// Google-Maps-style cycle (#116): static → tap → follow (auto-centre, north
// up) → tap → follow + heading rotation (map turns with the device) → tap →
// follow north-up again. Panning drops back to static; a two-finger rotate
// gesture takes over rotation manually and leaves heading mode.
//
// The FAB icon previews the state a tap will PRODUCE (via nextCompassState),
// not the current one — so it reads as an action. Because every next-state is
// a follow-state, only 'following' (centre), 'heading' (device compass), and
// 'driving' (GPS course, #242) glyphs are ever shown; there is no 'static' icon.
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
  driving: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="5,11 10,6 15,11"/>
    <polyline points="5,16 10,11 15,16"/>
  </svg>`,
}
const COMPASS_LABELS = {
  following: 'Rotate map with heading (compass mode)',
  heading: 'Switch to driving mode (GPS course)',
  driving: 'Back to north-up',
  static: 'Resume following (compass mode)',
}

// Cycle order for the progress ring (#259) — tap destinations only. Static is
// unreachable via tap (only via map pan/rotate), so it's not in this cycle.
// nextCompassState cycles: following → heading → driving → following.
const COMPASS_CYCLE = ['following', 'heading', 'driving']

let compassState = { follow: true, source: null }
function updateCompassIcon() {
  // Icon = the state a tap produces (preview); label = the action from here.
  // Ring = the CURRENT state's position (not the preview), so the two don't
  // contradict each other at a glance.
  const currentIdx = COMPASS_CYCLE.indexOf(compassGlyph(compassState))
  el('recenter-btn').innerHTML = fabRingSvg(currentIdx, COMPASS_CYCLE.length) + COMPASS_ICONS[compassGlyph(nextCompassState(compassState))]
  el('recenter-btn').setAttribute('aria-label', COMPASS_LABELS[compassGlyph(compassState)])
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

// GPS-course rotation ("driving mode", #242) — steadier than the
// magnetometer while actually driving. No permission prompt needed (GPS is
// already active); applyCourseHeading is called from startGpsWatch's onFix
// whenever this mode is active, holding the last known heading across the
// null/NaN readings devices report while stationary and gating out
// low-speed course jitter (see resolveCourseHeading).
let lastCourseHeading = null
function enableCourseRotation() { lastCourseHeading = null; return true }
function disableCourseRotation() { lastCourseHeading = null }
function applyCourseHeading(heading, speed) {
  const resolved = resolveCourseHeading(heading, lastCourseHeading, speed)
  if (!Number.isFinite(resolved) || !state.map) return
  lastCourseHeading = resolved
  state.map.setBearing(bearingForHeading(resolved))
}

// ---------------------------------------------------------------------------
// Isolate-sender event
// ---------------------------------------------------------------------------

// The current target selection as a Set of lowercased ids (or null when empty),
// passed to the map + target list for membership highlighting (#178).
// The ids to filter on right now, expanded from the selected NODE keys against
// the current target-list clusters (#268). Re-derived rather than stored, so a
// node heard under a new id variant after selection is still caught instead of
// silently dropping out of the map and Locate.
//
// Memoised on the identity of the rows and the key list, both of which are
// replaced wholesale rather than mutated (lastRows per tick, keys per
// selection change). senderList runs the dedupe+merge pass, which is already
// the most expensive thing on the render tick, so this must not add another
// one per caller.
let selCache = { rows: null, keys: null, set: null }
function selectedSet() {
  if (!state.filter.sender) return null
  const keys = state.filter.sender.keys
  if (selCache.rows === state.lastRows && selCache.keys === keys) return selCache.set
  const set = expandSelection(keys, senderList(state.lastRows, { ignore: state.ignore }))
  selCache = { rows: state.lastRows, keys, set }
  return set
}

// state.filter carries selected node KEYS; makeFilter and isFilterActive work
// on ids. Expand at that boundary so the pure filter module keeps one shape.
function activeFilter() {
  const sel = selectedSet()
  return { ...state.filter, sender: sel && sel.size ? { ids: [...sel] } : null }
}

// Chip label reflects the target selection: none → prompt, one → the sender's
// name, more → a count (#178).
function updateTargetChip() {
  const chip = el('target-chip')
  // Counts selected nodes, not their id variants — a merged row is one target,
  // and counting ids made a single tap report "3 targets" (#268).
  const ids = state.filter.sender ? state.filter.sender.keys : []
  if (ids.length === 0) {
    chip.textContent = 'Select target'
    chip.classList.remove('active')
    chip.removeAttribute('title')
    return
  }
  chip.classList.add('active')
  // Never render a full-length id: feed.js's own rule, and the reason #305
  // saw the chip push the topbar off-screen. Unresolved falls back to the same
  // 6-char prefix the target list uses.
  const name = ids.length === 1
    ? (state.senderLabels.get(ids[0]) || idPrefix(ids[0]))
    : ids.length + ' targets'
  chip.textContent = '⌖ ' + name
  // The chip clips long names at 130px (#305). A title recovers the full one,
  // but only on pointer devices — Android Chrome and Bluefy have no hover, and
  // a long-press on a <button> opens the selection menu instead. So it is a
  // desktop affordance, not the fix; the fix is that the text is a name or a
  // 6-char prefix rather than an unbounded id. No ⌖ here — the glyph is
  // decoration and would just be read out twice.
  chip.title = name
}

// Target selection is a set of NODE keys (#268; #178 originally stored raw
// ids). detail = null clears;
// { id, toggle:true } adds/removes one (the checkbox rows); { id } replaces the
// whole selection with just that sender (a map popup's "Isolate sender").
// A target-list row can represent several prefix-compatible id variants of
// the same physical node (#267, decided 2026-07-18: multi-id selection) —
// detail.ids carries that full group so toggling/selecting the row catches
// receptions under any variant, not just the one currently displayed. Falls
// back to the single id when a caller (e.g. the map popup) has no group.
document.addEventListener('hunt:isolate-sender', (e) => {
  const d = e.detail
  const keys = new Set(state.filter.sender ? state.filter.sender.keys : [])
  if (!d) {
    keys.clear()
  } else {
    const id = String(d.id).toLowerCase()
    // One key per node, not one per id variant (#268), resolved against the
    // rows in hand so the map popup and the target list agree (#297) — see
    // selectionKeyFor.
    const key = selectionKeyFor(senderList(state.lastRows || [], { ignore: state.ignore }), id, d.ids)
    // Store the label under the KEY, which is what updateTargetChip reads. It
    // used to be stored under the id: for a merged row the display record is
    // usually the most recent reception (often a prefix), so the lookup missed
    // and the chip fell through to rendering the raw 64-hex anchor (#297).
    if (d.label != null) state.senderLabels.set(key, d.label || String(d.id))
    if (d.toggle) {
      if (keys.has(key)) keys.delete(key); else keys.add(key)
    } else {
      keys.clear()
      keys.add(key)
    }
  }
  state.filter.sender = keys.size ? { keys: [...keys] } : null
  updateTargetChip()
  const clearBtn = el('ts-clear')
  if (clearBtn) clearBtn.hidden = !state.filter.sender
  refreshFilterState()
  updateDiscoverBtnVisual()
})

// ---------------------------------------------------------------------------
// Ignore-sender event
// ---------------------------------------------------------------------------

document.addEventListener('hunt:ignore-sender', (e) => {
  if (!e.detail || !e.detail.id) return
  const key = String(e.detail.id).toLowerCase()
  if (state.ignore.has(key)) state.ignore.delete(key)
  else state.ignore.add(key)
  saveIgnore(state.ignore)
  refreshFilterState()
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
  state.map.setTimeWindow(state.filter.windowMs)

  // Initialise the receptions log (#130) — replaces the Messages panel. The
  // playhead reception highlights its map marker; tapping a marker rolls the
  // playhead to it (two-way sync).
  state.rxLog = createReceptionLog('rx-log', {
    onActiveChange: (rec) => { if (state.map) state.map.setHighlight(rec ? rec.id : null) },
  })
  if (state.map) state.map.onMarkerFocus((rec) => { if (state.rxLog) state.rxLog.focusRecord(rec.id) })

  // Build sheets (static HTML injected once)
  buildFilterSheet()
  buildSettingsSheet()
  buildTargetSheet()

  // Wire controls
  el('connect-btn').addEventListener('click', () => {
    if (!state.connected) { state.wakeLock.enable(); connectAll() }
  })

  // Onboarding: Settings → About re-opens the splash overlay; Close dismisses it.
  el('splash-close').addEventListener('click', () => { state.showOnboarding = false; refreshSplash() })
  // Tapping the dimmed scrim itself (not the panel/callouts/close button)
  // also dismisses the reopened tour (#216) — gated the same way as the
  // Close button, so pre-connect states are never dismissible this way.
  el('splash').addEventListener('click', (e) => {
    if (e.target !== e.currentTarget || !state.splashDismissible) return
    state.showOnboarding = false
    refreshSplash()
  })
  window.addEventListener('resize', () => { if (!el('splash').hidden) positionCallouts() })

  el('discover-btn').addEventListener('click', toggleAutoPing)

  // View FAB (#258): a persisted non-default state is applied to the map here,
  // same pattern as the sound mode below.
  updateViewIcon()
  el('layer-toggle').addEventListener('click', cycleView)
  const restoredView = VIEW_STATES[viewIdx]
  state.map.setView(restoredView.mode, restoredView.mode3D)
  el('nodepos-toggle').addEventListener('click', () => { toggleNodePositions().catch(() => {}) })

  // Sound FAB (#145). A persisted non-off mode is restored here; the engine
  // resumes its (autoplay-suspended) context on the first tap anywhere.
  updateSoundIcon()
  el('sound-toggle').addEventListener('click', cycleSound)
  if (state.soundMode !== 'off') sound.setMode(state.soundMode)

  // Compass button — always visible; cycles static → follow (north up) →
  // follow + device heading → follow + GPS course/driving mode (#242). See
  // the compass-mode section above.
  updateCompassIcon()
  el('recenter-btn').addEventListener('click', async () => {
    if (!state.map) return
    const next = nextCompassState(compassState)
    if (next.source === 'device' && compassState.source !== 'device') {
      // iOS permission prompt must run inside this click; denied → stay north-up
      if (!(await enableHeadingRotation())) next.source = null
    }
    if (next.source === 'course' && compassState.source !== 'course') enableCourseRotation()
    if (compassState.source === 'device' && next.source !== 'device') disableHeadingRotation()
    if (compassState.source === 'course' && next.source !== 'course') disableCourseRotation()
    if (next.source == null) state.map.setBearing(0)
    compassState.source = next.source
    if (next.follow && !compassState.follow) state.map.recenter() // fires onFollowChange → icon update
    else updateCompassIcon()
  })
  if (state.map) state.map.onFollowChange((follow) => {
    compassState.follow = follow
    if (!follow && compassState.source) {
      if (compassState.source === 'device') disableHeadingRotation()
      else if (compassState.source === 'course') disableCourseRotation()
      compassState.source = null
    }
    updateCompassIcon()
  })
  // Manual two-finger rotation takes over from heading-follow (the map keeps
  // the gestured bearing; the button returns it to north-up).
  if (state.map) state.map.onGestureRotate(() => {
    if (!compassState.source) return
    if (compassState.source === 'device') disableHeadingRotation()
    else disableCourseRotation()
    compassState.source = null
    updateCompassIcon()
  })
  if (state.map) state.map.onLocate(updateLocateInfo)

  // Locate overlay toggle — a styled checkbox in the topbar controls. Unchecked
  // by default (overlay off); ticking it shows the heatmap/markers/readout over
  // the filtered set. The estimate keeps computing regardless (see huntmap
  // drawLocate), so switching it on is instant.
  const locateCb = el('locate-checkbox')
  locateCb.checked = false
  if (state.map) state.map.setLocateVisible(false)
  locateCb.addEventListener('change', () => {
    if (state.map) state.map.setLocateVisible(locateCb.checked)
  })

  el('filter-pill').addEventListener('click', () => {
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
      refreshAccount()
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
    { sheet: el('filter-sheet'), toggle: el('filter-pill') },
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
    syncPopoverTriggers()
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
  refreshFilterState()
  // Reflect persisted attenuator/manual-fix state on the settings button
  refreshSettingsIndicator()
  initSplashContent()
  refreshSplash()

  // Resume capture promptly on return from background (#198, #199)
  document.addEventListener('visibilitychange', onVisibilityChange)
  el('bg-hint-close').addEventListener('click', dismissBgHint)

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
