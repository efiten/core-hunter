import { relTime } from './feed.js'
import { rssiTier, tierColorVar } from './signal.js'
import { packetTypeLabel } from './filters.js'
import { isHashIdKind } from './names.js'

// Receptions log (#130) — a frameless, log-style tail over the map that
// replaces the bottom Messages panel. Newest reception at the bottom; a fixed
// playhead lane (no line drawn) sits partway down and the reception on it is
// active; lines roll through and snap to it like a combination-lock dial.
//
// This file keeps the index/fade maths as small pure functions (unit-tested);
// createReceptionLog holds the DOM/scroll glue (verified by build + field test).

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// rxView selects the source set (filtered mirrors the map; all is every
// captured reception), sorts ascending by rx_at so the newest is last, and
// caps to the most recent `cap` — the log is bounded to a recent window rather
// than rendering the whole store.
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
// then back to full. Kasper's call, 31 August: three keeps a sense of rate,
// one is the glance, and both are worth having rather than picking one.
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

// Whether the chevron has anywhere to go at all. Below the smallest stop it
// would be a control that does nothing.
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

// How much of the ticker is on screen, as one stored value. A boolean plus a
// size would let a reload land on "closed and expanded", which is not a state.
// 'open' and 'closed' are what pre-#560 builds wrote, so every existing install
// arrives carrying one of the two; anything else reads as a first visit.
const RX_STORED = ['open', 'collapsed', 'minimal']

export function tickerState(stored) {
  if (stored === 'closed') return { visible: false, collapse: 0 }
  const i = RX_STORED.indexOf(stored)
  return { visible: true, collapse: i > 0 ? i : 0 }
}

export function tickerStored({ visible, collapse }) {
  if (!visible) return 'closed'
  return RX_STORED[collapse] || RX_STORED[0]
}

// The faintest a row on the card may be drawn (#560). Without a floor the fade
// reaches zero on the card's own top lane, so a ten-lane card showed six rows
// and four invisible ones: the height promised more than the opacity delivered.
export const RX_FADE_FLOOR = 0.22

// rxFade is the opacity of a line `d` rows from the playhead. Each side fades
// across the lanes there actually are on that side, down to RX_FADE_FLOOR
// rather than to nothing: a row the card has made room for must be legible,
// and the old fixed divisors reached zero on the outermost lane of each side.
// Newer rows still fall off faster than older ones, because there are fewer
// lanes below the playhead than above it.
export function rxFade(d, above = 6, below = 3) {
  if (d === 0) return 1
  const span = Math.max(1, d < 0 ? above : below)
  const t = Math.min(1, Math.abs(d) / span)
  return RX_FADE_FLOOR + (1 - t) * (1 - RX_FADE_FLOOR)
}

// ---------------------------------------------------------------------------
// DOM component
// ---------------------------------------------------------------------------

// Row height (#322). The stylesheet owns it as --ch-rx-line-h and the geometry
// around it (list height, scroll padding) is derived from the same variable, so
// there is one number instead of four kept in step by hand.
// ROW_H is what app.css ships, used when the variable can't be read.
const ROW_H = 26

// rxLineHeight parses the variable's value. A missing or unusable value falls
// back rather than yielding 0: rxActiveIndex divides scrollTop by this, and a 0
// would pin every row to the playhead lane.
export function rxLineHeight(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : ROW_H
}
const CAP = 200     // recent-window cap

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// The meta cell is where a reception explains itself: a decrypted text first,
// then a channel name, then the packet-type label. A trace reply we provoked
// also carries the SNR the node we pinged heard US at (#482) — the reciprocal
// of every other number in the log, and the reason the ping was sent — so on
// that one row the reading takes the type label's slot. One decimal, the same
// format as #hud-snr. `!= null` keeps a real 0 dB reading visible.
export function lineMeta(r) {
  if (r._text) return '“' + r._text + '”'
  if (r.channel_name) return r.channel_name
  if (r.heard_us_snr != null) return 'heard us at ' + r.heard_us_snr.toFixed(1) + ' dB'
  return packetTypeLabel(r.packet_type) || ''
}

// createReceptionLog builds the log inside `rootId` and returns
// { render, focusRecord }. onActiveChange(record|null) fires whenever the
// reception on the playhead changes (app wires it to the map highlight).
// onRowActivate(record) fires ONLY on a deliberate row tap (#309), which is
// what the app pans the map on. It is deliberately not onActiveChange: that
// one also fires on plain scroll, and on the map->ticker direction, where
// focusRecord rolls the playhead after a marker tap — panning there would
// move the camera off a marker the user just chose.
// senderText is the ticker's sender cell. meshpacket.js carries a 1-byte hash
// as its own sender_label, so printing the label unguarded put "77" on screen
// looking exactly like a resolved short name. Same # mark the HUD uses.
export function senderText(r) {
  if (isHashIdKind(r.sender_kind) && r.sender_id) return '#' + String(r.sender_id)
  return r.sender_label || r.sender_id || '—'
}

export function createReceptionLog(rootId, { onActiveChange, onRowActivate, onClose, onCollapse } = {}) {
  const root = document.getElementById(rootId)
  if (!root) return { render() {}, focusRecord() {} }
  // The ✕ hides the whole ticker (#539); the collapse chevron beside it moves
  // between full and three lanes (#560). One chevron that swaps direction, not
  // a pair of buttons. The app (onClose / onCollapse) owns both states and the
  // topbar button that brings a hidden card back.
  root.innerHTML = '<div class="rx-hd"><span class="rx-count">0 rx</span><span class="rx-tg" role="button" tabindex="0"></span>'
    + '<button type="button" class="rx-fold" aria-label="Collapse receptions" aria-expanded="true">'
    + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>'
    + '</button>'
    + '<button type="button" class="rx-close" aria-label="Hide receptions">'
    + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>'
    + '</button></div><div class="rx-list" id="rx-list"></div>'
  const countEl = root.querySelector('.rx-count')
  const tgEl = root.querySelector('.rx-tg')
  const foldEl = root.querySelector('.rx-fold')
  const list = root.querySelector('.rx-list')
  let collapse = 0
  if (onClose) root.querySelector('.rx-close').addEventListener('click', onClose)
  if (onCollapse) foldEl.addEventListener('click', () => onCollapse(nextCollapse(collapse, view.length)))

  let mode = 'filtered'
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

  // The browser's own maximum, not (rows - 1) * lineH. Since #560 there is no
  // padding under the last row, so the list cannot scroll far enough to put the
  // last row on the playhead, and it clamps with that row on the bottom lane
  // instead. Comparing against the JS lane count would make atBottom() never
  // true, which latches `follow` off and stops the card following live traffic.
  const maxScroll = () => Math.max(0, list.scrollHeight - list.clientHeight)
  const atBottom = () => list.scrollTop >= maxScroll() - 2

  function rebuild() {
    view = rxView(filtered, all, mode, CAP)
    // With nothing to show the card collapses to its header (#539): ten empty
    // lanes on a visible plate is a large dark rectangle over the map for no
    // information, where the old frameless band was simply invisible.
    root.classList.toggle('rx-empty', view.length === 0)
    // The card's height, and the two paddings that put the newest reception
    // where it belongs at that height (#560). Published as lane counts; the
    // stylesheet multiplies them by --ch-rx-line-h, so the row height stays
    // one number in one place.
    const lanes = rxLanes(view.length, collapse)
    list.style.setProperty('--rx-lanes', lanes)
    list.style.setProperty('--rx-playhead', rxPlayhead(lanes))
    list.style.setProperty('--rx-pad-bottom', rxPadBottom())
    foldEl.hidden = !rxCanCollapse(view.length)
    // The chevron points down while there is further to collapse and up on the
    // last stop, where the next tap is the way back to full. One control that
    // swaps state, three stops.
    const atLast = atLastCollapse(collapse, view.length)
    foldEl.dataset.dir = atLast ? 'up' : 'down'
    foldEl.setAttribute('aria-expanded', String(collapse === 0))
    foldEl.setAttribute('aria-label', atLast ? 'Expand receptions' : 'Collapse receptions')
    root.classList.toggle('rx-collapsed', collapse > 0)
    const filteredIds = new Set(filtered.map((r) => r.id))
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
      const nm = mode === 'all' && !filteredIds.has(r.id) ? ' <span class="rx-nm" title="Outside your current filter, so it has no marker on the map.">outside filter</span>' : ''
      h += '<div class="rx-ln" data-idx="' + i + '" data-id="' + esc(r.id) + '">'
        + '<span class="rx-gt"></span>'
        + '<span class="rx-tm">' + esc(relTime(r.rx_at, nowMs)) + '</span>'
        + '<span class="rx-rs" style="color:' + color + '">' + esc(r.rssi ?? '—') + '</span>'
        + '<span class="rx-sn">' + esc(senderText(r)) + ' '
        + '<span class="rx-me">' + esc(lineMeta(r)) + '</span>' + nm + '</span></div>'
    }
    list.innerHTML = h
    if (follow) list.scrollTop = maxScroll()
    else {
      const idx = view.findIndex((r) => r.id === activeId)
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
      else { els[i].classList.remove('act'); els[i].style.opacity = String(rxFade(d, rxPlayhead(rxLanes(n, collapse)), rxBelow(rxLanes(n, collapse)))) }
    }
    const rec = view[ai]
    if (rec && rec.id !== activeId) { activeId = rec.id; onActiveChange && onActiveChange(rec) }
  }

  function toLane(idx) {
    list.scrollTop = idx * LINE_H
    follow = atBottom()
    paint()
  }

  list.addEventListener('click', (e) => {
    const l = e.target.closest('.rx-ln')
    if (!l) return
    const idx = Number(l.dataset.idx)
    toLane(idx)
    // After toLane, so the highlight (via onActiveChange) is already on this
    // record when the camera moves.
    if (onRowActivate && view[idx]) onRowActivate(view[idx])
  })
  list.addEventListener('scroll', () => { follow = atBottom(); paint() })
  const toggle = () => { mode = mode === 'filtered' ? 'all' : 'filtered'; follow = true; rebuild() }
  tgEl.addEventListener('click', toggle)
  tgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })

  function render(filteredRecords, allRecords, now) {
    filtered = filteredRecords || []
    all = allRecords || []
    nowMs = now ?? Date.now()
    rebuild()
  }

  // focusRecord rolls the playhead to a given reception (fired when its map
  // marker is tapped). No-op if the record isn't in the current view.
  function focusRecord(id) {
    const idx = view.findIndex((r) => String(r.id) === String(id))
    if (idx >= 0) toLane(idx)
  }

  // setCollapse comes from the app, not from the click handler, so the stored
  // state and what is on screen cannot disagree: the click reports upwards and
  // the app hands the new level back down.
  function setCollapse(level) {
    const next = Number.isInteger(level) && level > 0 ? Math.min(level, RX_COLLAPSE_STOPS.length) : 0
    if (collapse === next) return
    collapse = next
    follow = true
    rebuild()
  }

  return { render, focusRecord, setCollapse }
}
