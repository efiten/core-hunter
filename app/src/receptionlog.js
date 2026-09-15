import { relTime, idPrefix } from './feed.js'
import { rssiTier, tierColorVar } from './signal.js'
import { packetTypeLabel } from './filters.js'
import { isHashIdKind, displayName } from './names.js'

// Receptions log (#130) — a frameless, log-style tail over the map that
// replaces the bottom Messages panel. Newest reception at the bottom; a
// playhead lane (no line drawn) sits partway down and the reception on it is
// active; lines roll through and snap to it like a combination-lock dial. The
// lane is where the marker starts rather than where it is pinned: over the
// last rows, which the list has no scroll left to reach, the marker walks down
// to them instead (#619).
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
// nextRxMode is the filtered/all switch. One stand, shared with the HUD
// (#555): with a filter set you look at the filtered set on both surfaces,
// and flipping it in either place flips both. Anything unknown lands on
// filtered, the stand the app opens in.
export function nextRxMode(mode) {
  return mode === 'filtered' ? 'all' : 'filtered'
}

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

// rxStepIndex moves the playhead one row back or forward (#555): the float
// readout's previous/next buttons scrub the same list the ticker shows. Clamped
// to the list, and a stale index (rows dropped by the cap since the last paint)
// lands on the nearest real row. -1 on an empty list, like rxActiveIndex.
export function rxStepIndex(active, delta, count) {
  if (count <= 0) return -1
  const cur = Number(active)
  const clamp = (i) => Math.min(Math.max(i, 0), count - 1)
  // Off the list means the position was stale: land on the nearest row
  // first, without stepping past it.
  if (!(cur >= 0 && cur < count)) return clamp(cur || 0)
  return clamp(cur + (delta < 0 ? -1 : 1))
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
// short of the lane, and that clamp is what parks the newest reception on the
// bottom lane. Both things at once, which is what "laatste onderaan" and
// "rol-door" each needed.
//
// The clamp also costs the rows past it their scroll position: every one of
// them sits at the same scrollTop, so the marker rather than the list moves
// over those last lanes (#619, rxMarkerLane). This is the lane it starts from,
// not the only lane it is ever on.
export function rxPlayhead(lanes) {
  if (lanes <= 1) return 0
  return Math.round((lanes - 1) * 2 / 3)
}

// rxBelow is how many lanes sit under the marker, so newer receptions have
// somewhere to roll through. Zero on the small cards, where there is no room
// and the newest reception is the active one.
//
// It answers for the playhead lane by default, which is where the marker sits
// until the list runs out of scroll (#619). Past that the marker walks down
// and the fade is measured from where it actually is, so callers drawing the
// fade pass the lane rather than assuming the playhead's.
export function rxBelow(lanes, lane = rxPlayhead(lanes)) {
  return Math.max(0, lanes - 1 - lane)
}

// rxPadBottom is the padding under the last row, in lanes: none. It used to be
// three, which is what reserved the blank lanes a full card ended in. It stays
// a function because the geometry reads better as four derived numbers than as
// three plus a literal zero, and because the reachability assertion below is
// written against it.
export function rxPadBottom() {
  return 0
}

// rxMaxScroll is how far the list can be scrolled, in lanes. With the playhead
// lane's worth of padding above the rows and none below (#560), the content is
// `count + playhead` lanes tall inside a card of `lanes`, and the browser stops
// there. atBottom() still asks the browser rather than this — sub-pixel row
// heights make the two disagree by a fraction — but which rows a scroll
// position can name is a question about the geometry, and that is this.
export function rxMaxScroll(count, lanes) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  return Math.max(0, n + rxPlayhead(lanes) - lanes)
}

// rxScrollLane is the scroll position that puts row `index` under the marker,
// in lanes. Up to the clamp that is the row itself; past it the list has
// nowhere left to go and stays put, which is what makes the marker do the
// moving instead (#619).
export function rxScrollLane(index, count, lanes) {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0
  return Math.min(i, rxMaxScroll(count, lanes))
}

// rxMarkerLane is the lane the marker sits on for a given row (#619). It is
// the playhead lane for every row the list can still scroll to, and walks down
// one lane for each row past the clamp, so the newest reception ends up on the
// bottom lane rather than three lanes out of reach. The old behaviour read the
// row off the scroll position alone, which stopped at `count - 4` on a full
// card: the last three rows could not be tapped onto the marker, were drawn
// faintest, and the HUD that shares the marker showed the fourth-newest.
export function rxMarkerLane(index, count, lanes) {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0
  return rxPlayhead(lanes) + (i - rxScrollLane(i, count, lanes))
}

// rxCountLabel is the header's count (#638). It used to print the length of
// the view, which is capped at CAP rows, so a session that heard more than
// that read "200 rx" for the rest of its life: the size of a window, standing
// where a count belongs. It now takes the total for the stand on show.
//
// `truncated` is for a total that is only a lower bound. The app counts its
// own store and never needs it; the map has no store to count and knows only
// what the server returned, so a full page with more rows behind it says so
// rather than claiming a total it cannot know.
export function rxCountLabel(total, truncated = false) {
  const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  return n.toLocaleString('en') + (truncated ? '+' : '') + ' rx'
}

// outsideWindow is the gap between what the list shows and what the map draws
// (#646). The list is row-bounded — the newest CAP receptions, however old they
// are — while the map draws the chosen time window, so on a quiet mesh the list
// reaches back past the window's edge and the map has nothing for those rows.
// Returns how many fall outside and how old the oldest of them is, which is
// what decides the window a tap would widen to.
//
// A row whose timestamp cannot be read counts as neither. It is not evidence
// that anything is missing, and it must not drag the offered window wider.
export function outsideWindow(rows, windowMs, nowMs) {
  let count = 0
  let oldestAgeMs = 0
  if (windowMs == null) return { count, oldestAgeMs }
  for (const r of rows || []) {
    const at = Date.parse(r && r.rx_at)
    if (Number.isNaN(at)) continue
    const age = nowMs - at
    if (age <= windowMs) continue
    count++
    if (age > oldestAgeMs) oldestAgeMs = age
  }
  return { count, oldestAgeMs }
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
// looking exactly like a resolved short name. Same # mark the HUD uses. A hash
// id placed on one registry node by reach (#661) reads by that node's name.
export function senderText(r) {
  if (isHashIdKind(r.sender_kind) && r.sender_id) return displayName(r) || '#' + String(r.sender_id)
  // A name resolved for a short prefix wears the guess mark (#452, names.js),
  // and the attribution by reach decides a relay's name first.
  return displayName(r) || r.sender_id || '—'
}

// senderCell splits the sender into the id column and the name cell (#451).
// A line used to show a name OR an id, so the id a name resolved from was
// gone the moment it resolved, and a mis-resolution (#452) had nothing on
// screen to check against. Once a name has resolved the id stands beside it,
// cut with idPrefix like the target list and the HUD; a line without a name
// keeps the id in the name cell and the column empty, so a prefix is never
// printed twice. A hash id is its # mark and nothing else, until it is placed
// on a named node by reach (#661): then the # id stands beside that name. A
// label that is the id is no name either: meshpacket.js gives a channel_name
// sender its decrypted name as both. For a row without an attribution this is
// the rule of web/receptionticker.js; the map's ticker does not attribute.
export function senderCell(r) {
  const name = senderText(r)
  if (isHashIdKind(r.sender_kind) && r.sender_id) {
    const hashId = '#' + String(r.sender_id)
    return { id: name === hashId ? '' : hashId, name }
  }
  const resolved = !!r.sender_id && name !== String(r.sender_id)
  return { id: resolved ? idPrefix(r.sender_id) : '', name }
}

export function createReceptionLog(rootId, { onActiveChange, onRowActivate, onClose, onCollapse, onModeChange, onWiden } = {}) {
  const root = document.getElementById(rootId)
  if (!root) return { render() {}, focusRecord() {}, setCollapse() {}, setMode() {}, step() {}, follow() {}, active() { return null }, following() { return true } }
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
    + '</button></div>'
    // The window note (#646) sits between the header and the list, never in
    // it: paint() walks list.children index-parallel with `view`, active()
    // feeds the HUD from view[ai], and the card's height comes from counting
    // lanes. A row here that is not a reception would take a lane, could land
    // under the marker, and would reach the HUD as "the reception you are
    // looking at".
    + '<div class="rx-note" hidden role="button" tabindex="0"></div>'
    + '<div class="rx-list" id="rx-list"></div>'
  const countEl = root.querySelector('.rx-count')
  const noteEl = root.querySelector('.rx-note')
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
  let counts = { filtered: 0, all: 0 }
  // What the list shows and the map cannot draw (#646): { count, label }, where
  // label names the window a tap would widen to. null when nothing is outside.
  let outside = null
  let nowMs = Date.now()
  let activeId = null
  // The row under the marker, when one was named deliberately: a tap, a scrub,
  // a marker on the map, or following the newest. It has to be remembered
  // because past the clamp the scroll position cannot tell the last lanes
  // apart — every row there sits at the same scrollTop (#619). null means no
  // such row, and the scroll position answers again.
  let activeIdx = null

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
    countEl.textContent = rxCountLabel(mode === 'all' ? counts.all : counts.filtered)
    paintNote()
    tgEl.innerHTML = mode === 'filtered'
      ? '<b>filtered</b><span class="rx-off"> · all</span>'
      : '<span class="rx-off">filtered · </span><b>all</b>'
    let h = ''
    for (let i = 0; i < view.length; i++) {
      const r = view[i]
      const color = cssVar(tierColorVar(rssiTier(r.rssi)))
      const cell = senderCell(r)
      h += '<div class="rx-ln" data-idx="' + i + '" data-id="' + esc(r.id) + '">'
        + '<span class="rx-gt"></span>'
        + '<span class="rx-tm">' + esc(relTime(r.rx_at, nowMs)) + '</span>'
        + '<span class="rx-rs" style="color:' + color + '">' + esc(r.rssi ?? '—') + '</span>'
        + '<span class="rx-id">' + esc(cell.id) + '</span>'
        + '<span class="rx-sn">' + esc(cell.name) + ' '
        + '<span class="rx-me">' + esc(lineMeta(r)) + '</span></span></div>'
    }
    list.innerHTML = h
    if (follow) {
      list.scrollTop = maxScroll()
      activeIdx = view.length ? view.length - 1 : null
    } else {
      const idx = view.findIndex((r) => r.id === activeId)
      if (idx >= 0) { activeIdx = idx; list.scrollTop = rxScrollLane(idx, view.length, lanes) * LINE_H }
    }
    paint()
  }

  // paintNote writes the window note (#646): the rows on show that the map
  // cannot draw, said once above the list instead of once per row. Hidden when
  // nothing is outside, which is the ordinary case — a line that is always
  // there stops being read.
  function paintNote() {
    const n = outside && outside.count > 0 ? outside.count : 0
    noteEl.hidden = !n
    if (!n) return
    const step = outside.label ? ' · show ' + esc(outside.label) : ''
    noteEl.innerHTML = '<b>' + n + '</b> outside the map\'s window' + step
    noteEl.setAttribute('aria-label', n + ' of these receptions are older than the window the map draws'
      + (outside.label ? '. Show ' + outside.label + '.' : ''))
  }

  const widen = () => { if (onWiden) onWiden() }
  noteEl.addEventListener('click', widen)
  noteEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); widen() } })

  // markerIndex is the row under the marker. A row named deliberately wins;
  // with none named the scroll position answers, the way it always did.
  function markerIndex(n) {
    if (activeIdx == null) return rxActiveIndex(list.scrollTop, LINE_H, n)
    return Math.min(Math.max(activeIdx, 0), n - 1)
  }

  function paint() {
    const n = view.length
    if (!n) { if (activeId != null) { activeId = null; activeIdx = null; onActiveChange && onActiveChange(null) } return }
    const ai = markerIndex(n)
    const lanes = rxLanes(n, collapse)
    // The fade is measured from where the marker actually is (#619). Walked
    // onto the bottom lane it has nothing under it, and the rows above it span
    // the whole card rather than the six lanes above the playhead.
    const lane = rxMarkerLane(ai, n, lanes)
    const below = rxBelow(lanes, lane)
    const els = list.children
    for (let i = 0; i < els.length; i++) {
      const d = i - ai
      if (d === 0) { els[i].classList.add('act'); els[i].style.opacity = '' }
      else { els[i].classList.remove('act'); els[i].style.opacity = String(rxFade(d, lane, below)) }
    }
    const rec = view[ai]
    if (rec && rec.id !== activeId) { activeId = rec.id; onActiveChange && onActiveChange(rec) }
  }

  // toLane puts a row under the marker. Up to the clamp the list scrolls to
  // it; past the clamp there is no scroll left, so the row is remembered and
  // the marker walks to it instead (#619). Without that a tap on one of the
  // three newest rows set a scrollTop the browser threw away, and read as a
  // dead press.
  function toLane(idx) {
    const n = view.length
    activeIdx = Math.min(Math.max(idx, 0), n - 1)
    list.scrollTop = rxScrollLane(activeIdx, n, rxLanes(n, collapse)) * LINE_H
    // Following is the marker on the newest row, not merely the list at its
    // end: every row past the clamp sits at that same end.
    follow = atBottom() && activeIdx === n - 1
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
  list.addEventListener('scroll', () => {
    const n = view.length
    // Scrolling away from the end hands the marker back to the scroll
    // position. Arriving at the end by scrolling means the newest reception,
    // which is exactly the row the position cannot name (#619). A row put
    // there deliberately is left where it is: the scroll a tap causes must not
    // take it straight back off.
    if (!atBottom()) activeIdx = null
    else if (activeIdx == null) activeIdx = n ? n - 1 : null
    follow = atBottom() && activeIdx === n - 1
    paint()
  })
  // The header toggle asks the app to flip the shared stand; the app answers
  // through setMode, so the ticker and the HUD never disagree about it.
  const toggle = () => { if (onModeChange) onModeChange(nextRxMode(mode)); else setMode(nextRxMode(mode)) }
  function setMode(next) {
    if (next === mode) return
    mode = next
    follow = true
    rebuild()
  }
  tgEl.addEventListener('click', toggle)
  tgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })

  // `opts.totals` is how many receptions each stand actually has (#638), which
  // the caller knows and the component cannot: the rows it is handed are
  // already a capped read. Without it the header falls back to counting what
  // it was given, which is what it always did.
  //
  // `opts.outside` is the window note (#646): { count, label } for the rows on
  // show that fall outside the window the map draws, with the window a tap
  // would widen to. The caller owns the window, so it names the step; the card
  // only says how many and offers it.
  function render(filteredRecords, allRecords, now, opts) {
    const o = opts || {}
    filtered = filteredRecords || []
    all = allRecords || []
    counts = o.totals || { filtered: filtered.length, all: all.length }
    outside = o.outside || null
    nowMs = now ?? Date.now()
    rebuild()
  }

  // focusRecord rolls the playhead to a given reception (fired when its map
  // marker is tapped). No-op if the record isn't in the current view.
  function focusRecord(id) {
    const idx = view.findIndex((r) => String(r.id) === String(id))
    if (idx >= 0) toLane(idx)
  }

  // step moves the playhead one row (#555): the float readout's previous/next
  // buttons scrub through the ticker's own list. Stepping onto the newest row
  // is what makes the ticker follow again, the same as scrolling to the bottom.
  function step(delta) {
    const idx = rxStepIndex(markerIndex(view.length), delta, view.length)
    if (idx >= 0) toLane(idx)
  }

  // active is the reception on the playhead, or null with nothing to show.
  function active() {
    const i = markerIndex(view.length)
    return i >= 0 ? view[i] : null
  }

  // following: the playhead sits on the newest row.
  function following() { return follow }

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

  // followAgain puts the playhead back on the newest row (#453): a reception
  // that passes the filter goes on the HUD, so the ticker it shares its
  // playhead with cannot stay scrubbed. The row itself lands on the next
  // render; this scrolls to the current newest so the playhead is already
  // there when it does.
  function followAgain() {
    follow = true
    list.scrollTop = maxScroll()
    activeIdx = view.length ? view.length - 1 : null
    paint()
  }

  return { render, focusRecord, setCollapse, setMode, step, follow: followAgain, active, following }
}
