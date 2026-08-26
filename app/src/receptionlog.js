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

// rxFade is the opacity of a line `d` rows from the playhead: full on the lane,
// fading out over ~6 rows above (older) and faster over ~3 rows below (newer).
export function rxFade(d) {
  if (d === 0) return 1
  if (d < 0) return Math.max(0, 1 + d / 6)
  return Math.max(0, 1 - d / 3)
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

function lineMeta(r) {
  if (r._text) return '“' + r._text + '”'
  if (r.channel_name) return r.channel_name
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

export function createReceptionLog(rootId, { onActiveChange, onRowActivate } = {}) {
  const root = document.getElementById(rootId)
  if (!root) return { render() {}, focusRecord() {} }
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

  // Read once per instance rather than at module load: the stylesheet has to be
  // applied before the variable resolves, and both components are constructed
  // from DOM-ready code.
  const LINE_H = rxLineHeight(cssVar('--ch-rx-line-h'))

  const maxScroll = () => Math.max(0, (view.length - 1) * LINE_H)
  const atBottom = () => list.scrollTop >= maxScroll() - 2

  function rebuild() {
    view = rxView(filtered, all, mode, CAP)
    const filteredIds = new Set(filtered.map((r) => r.id))
    countEl.textContent = view.length + ' rx'
    tgEl.innerHTML = mode === 'filtered'
      ? '<b>filtered</b><span class="rx-off"> · all</span>'
      : '<span class="rx-off">filtered · </span><b>all</b>'
    let h = ''
    for (let i = 0; i < view.length; i++) {
      const r = view[i]
      const color = cssVar(tierColorVar(rssiTier(r.rssi)))
      const nm = mode === 'all' && !filteredIds.has(r.id) ? ' <span class="rx-nm">no marker</span>' : ''
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
      else { els[i].classList.remove('act'); els[i].style.opacity = String(rxFade(d)) }
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

  return { render, focusRecord }
}
