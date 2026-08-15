import { rssiTier, tierColorVar } from './shared/signal.js'
import { packetTypeLabel } from './packettypes.js'
import { senderName } from './names.js'

// Reception ticker (#224) — parity with app's Receptions log (app/src/receptionlog.js,
// #130): a scrollable tail-log of recent receptions, two-way synced with the
// map, auto-scrolling to new entries, with a filtered/all toggle.
//
// Not shared via #238 (which is scoped to signal/locate/names only): app reads
// its already-local IndexedDB store on every render tick; web has no local
// store at all and instead polls the server. rxView/rxActiveIndex/rxFade
// below are ported verbatim from app's copy for behavioural parity (same
// tests as app/src/__tests__/receptionlog.test.js) — everything else here is
// new, since the data source is fundamentally different.

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// rxView selects the source set (filtered mirrors the map's active filters;
// all additionally drops sender/type/direct-only, see tickerFilters), sorts
// ascending by rx_at so the newest is last, and caps to the most recent `cap`.
export function rxView(filtered, all, mode, cap = 200) {
  const src = mode === 'all' ? (all || []) : (filtered || [])
  const sorted = src.slice().sort((a, b) => Date.parse(a.rx_at) - Date.parse(b.rx_at))
  return cap > 0 && sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted
}

// rxActiveIndex maps the scroll position to the line sitting on the playhead
// lane (rows are fixed-height), clamped to the list; -1 when empty.
export function rxActiveIndex(scrollTop, lineH, count) {
  if (count <= 0) return -1
  let i = Math.round(scrollTop / lineH)
  if (i < 0) i = 0
  if (i > count - 1) i = count - 1
  return i
}

// rxFade is the opacity of a line `d` rows from the playhead: full on the lane,
// fading out over ~6 rows above (older) and faster over ~3 rows below (newer).
export function rxFade(d) {
  if (d === 0) return 1
  if (d < 0) return Math.max(0, 1 + d / 6)
  return Math.max(0, 1 - d / 3)
}

// relTime — ported from app/src/feed.js (not shared: #238 is scoped to
// signal/locate/names only). Same behaviour, own copy per this file's own
// "ported for parity, not shared" convention (see module docstring above).
export function relTime(rxAt, nowMs) {
  if (rxAt == null || Number.isNaN(Date.parse(rxAt))) return '—'
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}

// receptionKey is a synthetic per-row identity. /api/points rows carry no
// stable id (server/internal/store/query.go's Point struct has none) — unlike
// app, whose rows are IndexedDB records with an autoincrement id. The
// map<->ticker two-way sync needs a shared key so a marker and a ticker line
// for the same underlying reception agree on identity; this composes one
// from the fields the API does return. Two independent fetches of the same
// row (e.g. the map's bbox-scoped query and the ticker's bbox-less one)
// produce identical field values and therefore the same key.
export function receptionKey(r) {
  return `${r.rx_at}|${r.sender_id || ''}|${r.hunter_pubkey || ''}|${r.lat}|${r.lon}|${r.rssi}`
}

// tickerFilters derives the query for the ticker's two modes from the same
// plain object window.currentFilters() produces. "all" drops sender/types/hops
// but keeps hunter/from/to — web has no local store of "every reception ever"
// the way app does (its IndexedDB queue is a bounded working set); the
// backend may hold months of history, so "all" here means "everything in the
// current hunter+time window, ignoring the sender/type/direct-only
// narrowing", not literally unbounded. A deliberate, smaller scope than
// app's "all" — called out in the PR description as a real interpretation
// choice, not an oversight.
export function tickerFilters(filters, mode) {
  if (mode !== 'all') return { ...filters }
  // Both sender inputs travel under senderPairs since #223; dropping the old
  // `sender` key alone would leave the picker's selection applied in "all".
  return { ...filters, sender: '', senderPairs: [], types: '', hops: '' }
}

// isLiveWindow gates the ticker's recurring poll: re-fetching a fixed
// historical range every 5s would just re-fetch identical data. Returns true
// if `to` is at least "now", i.e., a rolling window that should keep polling.
// This avoids the UTC-vs-local-midnight mismatch that broke calendar-date
// comparison (#287 blocker 1).
export function isLiveWindow(toIso, nowMs) {
  if (!toIso) return true
  return Date.parse(toIso) >= nowMs
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function lineMeta(r) {
  return r.channel_name || packetTypeLabel(r.packet_type) || ''
}

// pointInRing: standard ray-casting test, on the [lat, lon] rings drawHex
// already builds from the heatmap GeoJSON (lat as y, lon as x). Hex cells are
// convex, so no winding subtleties apply. Plane geometry is fine at cell scale
// — a cell is tens of metres across, where the spherical correction is far
// below the precision anything here needs.
export function pointInRing(lat, lon, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    const straddles = (yi > lat) !== (yj > lat)
    if (straddles && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// newestInRing: which reception a click on a hex cell should send the ticker to.
//
// A heatmap cell is an aggregate — /api/heatmap returns best_rssi and a count,
// never the rows behind them — so the cell is matched against the receptions
// the ticker already holds. Newest rather than strongest: focusRecord moves the
// ticker's playhead and the ticker is ordered by time, so jumping to an old
// strong line would scroll away from what the user is watching.
//
// Returns null when the cell holds none of the loaded rows, which is ordinary
// rather than exceptional: the ticker caps at CAP recent rows while a cell is
// built from the whole filtered history. Callers treat null as "no sync
// available" and leave the ticker alone.
export function newestInRing(records, ring) {
  let best = null
  let bestAt = -Infinity
  for (const r of records || []) {
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue
    const at = Date.parse(r.rx_at)
    if (Number.isNaN(at) || at <= bestAt) continue
    if (!pointInRing(r.lat, r.lon, ring)) continue
    best = r
    bestAt = at
  }
  return best
}

// ---------------------------------------------------------------------------
// DOM component
// ---------------------------------------------------------------------------

const LINE_H = 20   // must match .rx-ln height in style.css
export const CAP = 200     // recent-window cap, mirrors app's; reused by map.js's fetch limit

// createReceptionTicker builds the log inside `rootId` and owns its own
// polling loop (unlike app's createReceptionLog, which is fed by the app's
// already-running 1s render tick — web has no local store to read on a
// tick, so the ticker fetches over HTTP itself).
//
// fetchFiltered/fetchAll: () => Promise<Point[]>, the two source queries.
// shouldPoll: () => boolean, gates only the recurring 5s re-fetch (#224) —
// the initial fetch and every refetch() call (wired to map.js's own filter-
// change refresh) always run regardless.
// onActiveChange(point|null) fires whenever the reception on the playhead
// changes (map.js wires this to the map highlight).
export function createReceptionTicker(rootId, { fetchFiltered, fetchAll, shouldPoll, onActiveChange } = {}) {
  const root = document.getElementById(rootId)
  if (!root) return { refetch() {}, focusRecord() {}, records: () => [], destroy() {} }
  root.innerHTML = '<div class="rx-hd"><span class="rx-count">0 rx</span><span class="rx-tg" role="button" tabindex="0"></span></div><div class="rx-list" id="rx-list"></div>'
  const countEl = root.querySelector('.rx-count')
  const tgEl = root.querySelector('.rx-tg')
  const list = root.querySelector('.rx-list')

  let mode = 'filtered'
  let follow = true
  let filtered = []
  let all = []
  let view = []
  let nowMs = Date.now()
  let activeId = null

  const key = (r) => receptionKey(r)
  const maxScroll = () => Math.max(0, (view.length - 1) * LINE_H)
  const atBottom = () => list.scrollTop >= maxScroll() - 2

  let _lastSig = null
  function rebuild() {
    view = rxView(filtered, all, mode, CAP)
    // Signature of current view state: if unchanged, skip rebuild to avoid
    // teleporting a scrolled reader (#287 blocker 5).
    const sig = view.map(key).join('|') + '#' + mode
    if (sig === _lastSig) {
      // Same rows, but they aged: refresh only the relative-time cells. Without
      // this a quiet mesh freezes every row at the age it first rendered, which
      // reads as "just received".
      const els = list.children
      for (let i = 0; i < els.length && i < view.length; i++) {
        const tm = els[i].children[1]
        if (tm) tm.textContent = relTime(view[i].rx_at, nowMs)
      }
      paint(); return
    }
    _lastSig = sig

    const filteredIds = new Set(filtered.map(key))
    countEl.textContent = view.length + ' rx'
    tgEl.innerHTML = mode === 'filtered'
      ? '<b>filtered</b><span class="rx-off"> · all</span>'
      : '<span class="rx-off">filtered · </span><b>all</b>'
    let h = ''
    for (let i = 0; i < view.length; i++) {
      const r = view[i]
      const color = cssVar(tierColorVar(rssiTier(r.rssi)))
      const nm = mode === 'all' && !filteredIds.has(key(r)) ? ' <span class="rx-nm">no marker</span>' : ''
      h += '<div class="rx-ln" data-idx="' + i + '" data-key="' + esc(key(r)) + '">'
        + '<span class="rx-gt"></span>'
        + '<span class="rx-tm">' + esc(relTime(r.rx_at, nowMs)) + '</span>'
        + '<span class="rx-rs" style="color:' + color + '">' + esc(r.rssi ?? '—') + '</span>'
        + '<span class="rx-sn">' + esc(senderName(r)) + ' '
        + '<span class="rx-me">' + esc(lineMeta(r)) + '</span>' + nm + '</span></div>'
    }
    list.innerHTML = h
    if (follow) list.scrollTop = maxScroll()
    else {
      const idx = view.findIndex((r) => key(r) === activeId)
      if (idx >= 0) list.scrollTop = idx * LINE_H
    }
    paint()
  }

  function paint() {
    const n = view.length
    if (!n) { if (activeId != null) { activeId = null; onActiveChange && onActiveChange(null) } return }
    const ai = rxActiveIndex(list.scrollTop, LINE_H, n)
    const els = list.children
    for (let i = 0; i < els.length; i++) {
      const d = i - ai
      if (d === 0) { els[i].classList.add('act'); els[i].style.opacity = '' }
      else { els[i].classList.remove('act'); els[i].style.opacity = String(rxFade(d)) }
    }
    const rec = view[ai]
    if (rec && key(rec) !== activeId) { activeId = key(rec); onActiveChange && onActiveChange(rec) }
  }

  function toLane(idx) {
    list.scrollTop = idx * LINE_H
    follow = atBottom()
    paint()
  }

  list.addEventListener('click', (e) => {
    const l = e.target.closest('.rx-ln')
    if (l) toLane(Number(l.dataset.idx))
  })
  list.addEventListener('scroll', () => { follow = atBottom(); paint() })

  async function fetchAndRebuild() {
    nowMs = Date.now()
    try {
      filtered = (await fetchFiltered()) || []
      if (mode === 'all') all = (await fetchAll()) || []
    } catch (_) {
      return // keep the last good view; retried on the next trigger
    }
    rebuild()
  }

  const toggle = () => { mode = mode === 'filtered' ? 'all' : 'filtered'; follow = true; fetchAndRebuild() }
  tgEl.addEventListener('click', toggle)
  tgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })

  // focusRecord rolls the playhead to a given reception (fired when its map
  // marker is tapped). No-op if the record isn't in the current view.
  function focusRecord(k) {
    const idx = view.findIndex((r) => key(r) === k)
    if (idx >= 0) toLane(idx)
  }

  fetchAndRebuild()
  const timer = setInterval(() => { if (!shouldPoll || shouldPoll()) fetchAndRebuild() }, 5000)

  // The rows currently on screen, for callers that need to match something
  // against them — a hex-cell click has no reception of its own to key on
  // (#224), since /api/heatmap returns aggregates. Returns the active view, so
  // it honours the filtered/all toggle the user actually has selected.
  const records = () => view.slice()

  return { refetch: fetchAndRebuild, focusRecord, records, destroy() { clearInterval(timer) } }
}
