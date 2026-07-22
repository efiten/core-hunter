import { rssiTier, tierColorVar } from './signal.js'
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

// receptionKey is a synthetic per-row identity. /api/points rows carry no
// stable id (server/internal/store/query.go's Point struct has none) — unlike
// app, whose rows are IndexedDB records with an autoincrement id. The
// map<->ticker two-way sync needs a shared key so a marker and a ticker line
// for the same underlying reception agree on identity; this composes one
// from the fields the API does return. Two independent fetches of the same
// row (e.g. the map's bbox-scoped query and the ticker's bbox-less one)
// produce identical field values and therefore the same key.
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
  return { ...filters, sender: '', types: '', hops: '' }
}

// isLiveWindow gates the ticker's recurring poll: re-fetching a fixed
// historical range every 5s would just re-fetch identical data. Compares UTC
// calendar dates (not local) so the check is deterministic regardless of the
// runner's timezone; the ticker still gets an initial fetch and a fetch on
// every filter change (see createReceptionTicker) regardless of this check —
// only the automatic interval is skipped for a non-"now" range.
export function isLiveWindow(toIso, nowMs) {
  if (!toIso) return true
  const day = (ms) => new Date(ms).toISOString().slice(0, 10)
  return day(Date.parse(toIso)) === day(nowMs)
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function lineMeta(r) {
  return r.channel_name || packetTypeLabel(r.packet_type) || ''
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
  if (!root) return { refetch() {}, focusRecord() {}, destroy() {} }
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

  function rebuild() {
    view = rxView(filtered, all, mode, CAP)
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

  return { refetch: fetchAndRebuild, focusRecord, destroy() { clearInterval(timer) } }
}
