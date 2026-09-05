import { rssiTier, tierColorVar } from './signal.js'
import { packetTypeLabel } from './packettypes.js'
import { senderName, isHashIdKind } from './names.js'

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
// The faintest a row on the card may be drawn (#560/#424). Without a floor the
// fade reaches zero on the outermost lane of each side, which was harmless
// while those lanes were blank padding and is not now that they hold
// receptions. Kept identical to the app's; parity.test.js pins that.
export const RX_FADE_FLOOR = 0.22

export function rxFade(d, above = 6, below = 3) {
  if (d === 0) return 1
  const span = Math.max(1, d < 0 ? above : below)
  const t = Math.min(1, Math.abs(d) / span)
  return RX_FADE_FLOOR + (1 - t) * (1 - RX_FADE_FLOOR)
}

// relTime — ported from app/src/feed.js (not shared: #238 is scoped to
// signal/locate/names only). Same behaviour, own copy per this file's own
// "ported for parity, not shared" convention (see module docstring above).
// ---------------------------------------------------------------------------
// Card geometry (#560). The card used to be ten lanes or nothing: 298px, a
// third of a 915px phone, whether it held one reception or two hundred. Worse,
// a full card did not even show ten: the playhead sat six lanes down with
// three lanes of padding under it, so ten receptions rendered as seven rows
// and three blank lanes.
//
// It now grows in steps, and every step shows whole receptions with the newest
// on the bottom lane. Kasper's curve, 31 August:
//
//   0 -> nothing but the header      3..5  -> 3 lanes
//   1..2 -> 1 lane                   6..9  -> 5 lanes
//                                    10+   -> 10 lanes
//
// Below six receptions the card shows everything it has; from six it caps, so
// the oldest roll off the top rather than the card taking the whole screen.
//
// Every number below is in lanes, and the stylesheet multiplies them by
// --ch-rx-line-h. Keeping them here rather than in the CSS is what lets the
// relationship between them be asserted instead of maintained by hand.
// ---------------------------------------------------------------------------
export const RX_FULL_LANES = 10

// Each step is the smallest reception count that earns it, highest first.
const RX_STEPS = [
  { from: 10, lanes: RX_FULL_LANES },
  { from: 6, lanes: 5 },
  { from: 3, lanes: 3 },
  { from: 1, lanes: 1 },
]

// The ceilings the chevron cycles through, after full: three lanes, then one,
// then back to full. Identical to the app's, and pinned equal by
// parity.test.js. Putting the ticker away is the cross, not a further stop
// (#424): folding to the header was the map's own way of doing it before it
// had a button in the bar to come back from.
export const RX_COLLAPSE_STOPS = [3, 1]

// collapseLevels is the cycle the chevron actually walks for a given number of
// receptions: full, then only those stops that would make the card smaller
// than it already is. A stop at or above the natural height is skipped, since
// tapping onto it changes nothing on screen and reads as a dead press. With
// three receptions the card is three lanes anyway, so the three-lane stop is
// not offered and the cycle is full <-> one lane.
export function collapseLevels(count) {
  const natural = rxLanes(count, 0)
  const levels = [0]
  for (let i = 0; i < RX_COLLAPSE_STOPS.length; i++) {
    if (RX_COLLAPSE_STOPS[i] < natural) levels.push(i + 1)
  }
  return levels
}

// nextCollapse advances that cycle. A level the current count cannot reach
// (stored while more had arrived, then the filter narrowed) is not in the
// list, so it falls back to full rather than to nothing.
export function nextCollapse(level, count) {
  const levels = collapseLevels(count)
  const i = levels.indexOf(level)
  return levels[(i + 1) % levels.length]
}

// Whether this is the last stop, so the next tap goes back to full. Used for
// the chevron's direction and its label.
export function atLastCollapse(level, count) {
  const levels = collapseLevels(count)
  return levels.length > 1 && levels[levels.length - 1] === level
}

// rxLanes is the card's height for what it currently holds. The collapse level
// is a ceiling rather than a size: with two receptions the card is one lane
// already, and forcing three would put back the blank lanes the growth exists
// to remove.
export function rxLanes(count, collapse) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  let lanes = 0
  for (const step of RX_STEPS) {
    if (n >= step.from) { lanes = step.lanes; break }
  }
  // `undefined`, not falsy: a stop of zero lanes is a real stop (the map's
  // header-alone one), and a truthiness check silently ignored it.
  const cap = RX_COLLAPSE_STOPS[(collapse | 0) - 1]
  return cap === undefined ? lanes : Math.min(lanes, cap)
}

// Whether the chevron has anywhere to go at all. On the map that is always,
// since folding to the header is a stop of its own and is worth reaching even
// with nothing to show.
export function rxCanCollapse(count) {
  return collapseLevels(count).length > 1
}

// rxPlayhead is the lane the active reception sits on, counted from the top.
// It keeps the roll-through position of #130 at every card size: the original
// full card put it 6 of 9 lanes down, two thirds, with three lanes below for
// newer receptions to roll through, and that proportion is held here rather
// than restated per size.
//
// The blank lanes under a full card were never the playhead's fault. They came
// from padding the list below the last row, which is what rxPadBottom is now
// zero for. With no padding under it, the browser clamps the follow-scroll
// short of the lane, and that clamp is exactly what parks the newest reception
// on the bottom lane while the playhead stays where it is. Both things at once,
// which is what "laatste onderaan" and "rol-door" each needed.
export function rxPlayhead(lanes) {
  if (lanes <= 1) return 0
  return Math.round((lanes - 1) * 2 / 3)
}

// rxBelow is how many lanes sit under the playhead, so newer receptions have
// somewhere to roll through. Zero on the small cards, where there is no room
// and the newest reception is the active one.
export function rxBelow(lanes) {
  return Math.max(0, lanes - 1 - rxPlayhead(lanes))
}

// rxPadBottom is the padding under the last row, in lanes: none. It used to be
// three, which is what reserved the blank lanes a full card ended in. It stays
// a function because the geometry reads better as four derived numbers than as
// three plus a literal zero, and because the reachability assertion below is
// written against it.
export function rxPadBottom() {
  return 0
}

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

// Row height (#322). The stylesheet owns it as --ch-rx-line-h and the geometry
// around it (list height, scroll padding) is derived from the same variable, so
// there is one number instead of four kept in step by hand.
// ROW_H is what style.css ships, used when the variable can't be read.
const ROW_H = 26

// rxLineHeight parses the variable's value. A missing or unusable value falls
// back rather than yielding 0: rxActiveIndex divides scrollTop by this, and a 0
// would pin every row to the playhead lane.
// senderCell, the app's rule (app/src/receptionlog.js, #451): once a name has
// resolved the id stands beside it in its own column, cut to the same six
// characters the target picker uses; a line without a name keeps the id in
// the name cell and the column empty, and a hash id is its # mark only.
const ID_PREFIX_HEX_CHARS = 6
export function senderCell(pt) {
  const id = pt.sender_id ? String(pt.sender_id) : ''
  if (isHashIdKind(pt.sender_kind) && id) return { id: '', name: '#' + id }
  const name = senderName(pt)
  const resolved = !!id && name !== id
  return { id: resolved ? id.slice(0, ID_PREFIX_HEX_CHARS) : '', name }
}

export function rxLineHeight(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : ROW_H
}
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
  // .rx-grab is the drag frame (#424): two edge strips, top and left, that fade
  // in on hover. It is a sibling of the content rather than a border on the
  // band because pointer-events must land ONLY on the strips -- #rx-log sets
  // pointer-events:none on itself and re-enables it on .rx-hd/.rx-ln precisely
  // so drags and wheels reach Leaflet underneath (#287, #322). A frame across
  // the whole band would take panning away from the map it floats over.
  //
  // The collapse control sits in .rx-hd rather than at a fixed map corner as
  // #424 first described. That wording predates the decision that dragging
  // REPLACES the anchor: an icon pinned to the corner would be stranded away
  // from a ticker the user has moved, and it is the ticker it collapses.
  root.innerHTML = '<div class="rx-grab" aria-hidden="true"><span class="rx-grab-t"></span><span class="rx-grab-l"></span></div>'
    + '<div class="rx-hd"><span class="rx-count">0 rx</span><span class="rx-tg" role="button" tabindex="0"></span>'
    + '<button type="button" class="rx-fold" aria-expanded="true" aria-controls="rx-list">'
    + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>'
    + '</button>'
    + '<button type="button" class="rx-close" aria-label="Hide receptions">'
    + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>'
    + '</button></div>'
    + '<div class="rx-list" id="rx-list"></div>'
  // The header's two controls are handled by map.js, delegated on #rx-log: the
  // markup below is written after that module runs, so binding there directly
  // would find nothing. The app's component owns its own instead, because there
  // is no placement layer above it.
  const countEl = root.querySelector('.rx-count')
  const tgEl = root.querySelector('.rx-tg')
  const list = root.querySelector('.rx-list')

  let mode = 'filtered'
  let collapse = 0
  let follow = true
  let filtered = []
  let all = []
  let view = []
  let nowMs = Date.now()
  let activeId = null

  // Read once per instance rather than at module load: the stylesheet has to be
  // applied before the variable resolves, and both components are constructed
  // from DOM-ready code.
  const LINE_H = rxLineHeight(cssVar('--ch-rx-line-h'))

  const key = (r) => receptionKey(r)
  // The browser's own maximum, not (rows - 1) * lineH. Since #424 there is no
  // padding under the last row, so the list cannot scroll far enough to put
  // that row on the playhead and clamps with it on the bottom lane instead.
  // Comparing against the JS lane count would make atBottom() never true, which
  // latches `follow` off and stops the ticker following live traffic.
  const maxScroll = () => Math.max(0, list.scrollHeight - list.clientHeight)
  const atBottom = () => list.scrollTop >= maxScroll() - 2

  // The card's height and the lane the playhead sits on, published as lane
  // counts the stylesheet multiplies by --ch-rx-line-h (#424, mirroring #560).
  // rx-empty is the card with nothing to show: the header alone, the same
  // state the app renders. Putting the ticker away is the cross, which the app
  // owns, not a collapse stop.
  function applyGeometry() {
    const lanes = rxLanes(view.length, collapse)
    root.classList.toggle('rx-empty', lanes === 0)
    list.style.setProperty('--rx-lanes', lanes)
    list.style.setProperty('--rx-playhead', rxPlayhead(lanes))
    list.style.setProperty('--rx-pad-bottom', rxPadBottom())
  }

  // Owned by map.js, which keeps it in the URL alongside the placement, so the
  // stored state and what is on screen cannot disagree.
  function setCollapse(level) {
    const next = Number.isInteger(level) && level > 0 ? Math.min(level, RX_COLLAPSE_STOPS.length) : 0
    if (collapse === next) return
    collapse = next
    follow = true
    applyGeometry()
    list.scrollTop = maxScroll()
    paint()
  }

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

    applyGeometry()
    const filteredIds = new Set(filtered.map(key))
    countEl.textContent = view.length + ' rx'
    tgEl.innerHTML = mode === 'filtered'
      ? '<b>filtered</b><span class="rx-off"> · all</span>'
      : '<span class="rx-off">filtered · </span><b>all</b>'
    let h = ''
    for (let i = 0; i < view.length; i++) {
      const r = view[i]
      const color = cssVar(tierColorVar(rssiTier(r.rssi)))
      // "outside filter", not "no marker" (#539): the tag means the reception
      // is outside the current filter so the map draws nothing for it — it
      // says nothing about whether the sender is identified.
      const nm = mode === 'all' && !filteredIds.has(key(r)) ? ' <span class="rx-nm" title="Outside your current filter, so it has no marker on the map.">outside filter</span>' : ''
      const cell = senderCell(r)
      h += '<div class="rx-ln" data-idx="' + i + '" data-key="' + esc(key(r)) + '">'
        + '<span class="rx-gt"></span>'
        + '<span class="rx-tm">' + esc(relTime(r.rx_at, nowMs)) + '</span>'
        + '<span class="rx-rs" style="color:' + color + '">' + esc(r.rssi ?? '—') + '</span>'
        + '<span class="rx-id">' + esc(cell.id) + '</span>'
        + '<span class="rx-sn">' + esc(cell.name) + ' '
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
      else {
        const lanes = rxLanes(n, collapse)
        els[i].classList.remove('act')
        els[i].style.opacity = String(rxFade(d, rxPlayhead(lanes), rxBelow(lanes)))
      }
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

  return { refetch: fetchAndRebuild, focusRecord, records, setCollapse, destroy() { clearInterval(timer) } }
}
