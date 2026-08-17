// Generic browsable checkbox-row multi-select popover (#290) — the DOM/
// interaction half of the target-list picker (#223), lifted out of
// targetpicker.js so any "pick several of these" control in web/ shares one
// pattern instead of a native <select multiple> or an ad-hoc widget.
//
// A caller supplies a row-shape adapter:
//   idsOf(rec)             -> string[] the ids this row filters on, or idOf(rec)
//                             -> string for the one-id-per-row case. A row may
//                             stand for several ids (the sender picker merges
//                             one node's prefixes into a single row, #331), and
//                             then it selects and deselects as one unit.
//   rowParts(rec, nowMs)    -> { primary, secondary, meta: [string, ...] }
//   sigOf(rec, nowMs)       -> string, cheap change-detection signature
//   list(items, {limit})   -> the alphabetical/default-ordered slice to show
//   pinned(items, {count, nowMs}) -> optional; the pinned "Top" rows, or
//                                    omitted entirely to skip the pinned section
//   onPick(selectedSet)     -> optional side effect fired right after a toggle
// targetpicker.js's sender adapter and hunterpicker.js's hunter adapter are
// the two current instances.

import { popoverPosition } from './popoverPosition.js'

const PAGE_SIZE = 12

// Every row is treated as an id group, so the one-id adapters (hunters) and the
// merged-row adapter (senders, #331) go through exactly one selection path.
function idsOf(adapter, rec) {
  const raw = adapter.idsOf ? adapter.idsOf(rec) : adapter.idOf(rec)
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((i) => i != null && String(i) !== '').map((i) => String(i).toLowerCase())
}

function row(rec, { adapter, nowMs, selectedIds, onToggle }) {
  const li = document.createElement('li')
  li.className = 'tl-item'

  const ids = idsOf(adapter, rec)
  const selected = ids.some((i) => selectedIds.has(i))

  const btn = document.createElement('button')
  btn.type = 'button'; btn.className = 'tl-row'
  btn.classList.toggle('active', selected)
  btn.setAttribute('aria-pressed', String(selected))

  const check = document.createElement('span'); check.className = 'tl-check'; check.setAttribute('aria-hidden', 'true')

  const { primary, secondary, meta } = adapter.rowParts(rec, nowMs)
  const name = document.createElement('span'); name.className = 'tl-name'; name.textContent = primary

  const metaEl = document.createElement('span'); metaEl.className = 'tl-meta'
  if (secondary) {
    const prefix = document.createElement('span'); prefix.className = 'tl-prefix'; prefix.textContent = secondary
    metaEl.appendChild(prefix)
  }
  // Each meta entry carries its own class: the pre-refactor row gave rssi
  // .tl-rssi (accent) and time .tl-time (muted), and hardcoding .tl-rssi here
  // rendered "12m" in accent beside the rssi and left .tl-time matching
  // nothing. Accepts a plain string for the common case.
  for (const m of meta || []) {
    const { text, cls } = typeof m === 'string' ? { text: m, cls: 'tl-rssi' } : m
    const span = document.createElement('span'); span.className = cls || 'tl-rssi'; span.textContent = text
    metaEl.appendChild(span)
  }

  // An empty <span class="tl-meta"> still costs a 2px row-gap, which is what
  // made hunter rows taller than they needed to be for nothing.
  btn.append(check, name)
  if (metaEl.childNodes.length) btn.appendChild(metaEl)
  btn.addEventListener('click', () => ids.length && onToggle(ids))

  li.appendChild(btn)
  return li
}

// createMultiSelectPicker builds the browsable multi-select list + optional
// pinned section. It owns the selection as a lower-cased id Set; the caller's
// onChange fires whenever it moves, same shape as the original target picker.
export function createMultiSelectPicker(adapter, listEl, { pinnedEl, onChange, pinnedCount = 3 } = {}) {
  const selected = new Set()
  let visible = PAGE_SIZE
  let lastItems = []
  let _lastSig = null
  let _lastPinnedSig = null

  // Toggling is atomic over the row's whole id group: a merged row is one
  // target, so it selects and deselects as one, whichever of its prefixes was
  // already in the set (#331).
  function onToggle(ids) {
    const keys = (Array.isArray(ids) ? ids : [ids]).map((i) => String(i).toLowerCase())
    const anySelected = keys.some((k) => selected.has(k))
    for (const k of keys) { if (anySelected) selected.delete(k); else selected.add(k) }
    // Adapter-specific side effect on a pick (e.g. the sender adapter clears
    // the typed-prefix input, since a pick and a typed search are different
    // match kinds and shouldn't silently intersect).
    if (adapter.onPick) adapter.onPick(selected)
    if (onChange) onChange()
    render(lastItems, Date.now())
  }

  function render(items, nowMs) {
    lastItems = items || []
    const selKey = JSON.stringify([...selected].sort())

    if (pinnedEl && adapter.pinned) {
      const pinned = adapter.pinned(lastItems, { count: pinnedCount, nowMs })
      const pinnedSig = pinned.map((r) => adapter.sigOf(r, nowMs)).join('|') + '@' + selKey
      if (pinnedSig !== _lastPinnedSig) {
        _lastPinnedSig = pinnedSig
        pinnedEl.replaceChildren(...pinned.map((rec) => row(rec, { adapter, nowMs, selectedIds: selected, onToggle })))
      }
    }

    const list = adapter.list(lastItems, { limit: visible })
    const sig = list.map((r) => adapter.sigOf(r, nowMs)).join('|') + '#' + visible + '@' + selKey
    if (sig === _lastSig) return
    _lastSig = sig
    listEl.replaceChildren(...list.map((rec) => row(rec, { adapter, nowMs, selectedIds: selected, onToggle })))
  }

  function reset() {
    visible = PAGE_SIZE
    _lastSig = null
    _lastPinnedSig = null
  }

  listEl.addEventListener('scroll', () => {
    if (listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 24) return
    const total = adapter.list(lastItems).length
    if (visible >= total) return
    visible += PAGE_SIZE
    _lastSig = null
    render(lastItems, Date.now())
  })

  const getSelected = () => [...selected]
  function setSelected(ids) {
    selected.clear()
    for (const id of ids || []) if (typeof id === 'string' && id.trim()) selected.add(id.toLowerCase())
    render(lastItems, Date.now())
  }

  return { getSelected, setSelected, render, reset }
}

// placePopover puts an open panel where all of it is on screen (#372). The
// panels are position:fixed, so left/top are viewport coordinates and the CSS
// no longer anchors them to a toggle that moves when #bar wraps. Measure after
// unhiding: a display:none panel has a zero rect.
//
// #bar carries backdrop-filter, which per Filter Effects 2 makes it the
// containing block for its fixed descendants, so a written left/top is not
// necessarily a viewport coordinate. Engines disagree about the rule and this
// is a phone bug: Chromium applies it (popover.spec.js measures that), WebKit
// is the engine CI cannot reach. Today it happens not to matter, because #bar
// is fixed at the viewport origin with no border and no transform, so its
// padding box starts at (0,0) and the frames coincide.
//
// Rather than rest on that, the position is read back once and corrected by the
// delta. That makes the result frame-independent in either engine, and survives
// #bar later gaining a border, an offset or a transform. One extra rect read
// per open, and the correction is skipped entirely when the delta is subpixel
// noise (fractional DPR, browser zoom), so the common path still writes once.
//
// A single correction is exact for a translated frame. It would not be for a
// SCALED one (a transform: scale ancestor), where the delta itself changes with
// the value written -- #bar has no transform, and popover.spec.js pins that.
//
// viewport is injectable for tests: web/ has no jsdom, and this is the one part
// worth pinning without one. Production call sites omit it.
export function placePopover(toggleEl, panelEl, { align = 'left', viewport } = {}) {
  const vp = viewport || { width: window.innerWidth, height: window.innerHeight }
  const { left, top } = popoverPosition(
    toggleEl.getBoundingClientRect(),
    panelEl.getBoundingClientRect(),
    vp,
    { align },
  )
  panelEl.style.left = `${left}px`
  panelEl.style.top = `${top}px`

  const r = panelEl.getBoundingClientRect()
  const dx = r.left - left, dy = r.top - top
  if (Math.abs(dx) > 0.5) panelEl.style.left = `${left - dx}px`
  if (Math.abs(dy) > 0.5) panelEl.style.top = `${top - dy}px`
}

// wirePopover gives a toggle-button + panel the shared open/close shape
// (#223's "toggle button reveals a panel"): outside-click and Escape both
// close it. wrapEl scopes the outside-click check to this control's own
// wrapper element -- when several pickers share the same wrapper class
// (#290: sender + hunter both use .ms-wrap), a class-selector check alone
// can't tell them apart, so this takes the actual element and requires the
// click's nearest wrapSelector ancestor to be THIS wrap, not merely any wrap.
// onOpen lets a caller reset paging / refresh data each time the panel opens.
//
// Click detection is capture-phase, not bubble: a row click's own handler
// replaces the clicked button via listEl.replaceChildren() synchronously, so
// by the time a bubble-phase document listener would run, e.target is already
// detached and closest(wrapSelector) wrongly returns null, closing the panel
// after every pick. Capture runs before that mutation happens.
export function wirePopover({ toggleEl, panelEl, wrapEl, wrapSelector, onOpen, align = 'left' }) {
  function open() {
    panelEl.hidden = false
    toggleEl.setAttribute('aria-expanded', 'true')
    if (onOpen) onOpen()
    // After onOpen: it repopulates the rows, so the panel's height is only
    // final once it has run (#372).
    placePopover(toggleEl, panelEl, { align })
  }
  function close() {
    panelEl.hidden = true
    toggleEl.setAttribute('aria-expanded', 'false')
  }
  // #bar wraps, so a resize moves the toggle to another row and the panel has
  // to follow. Only while open: a measurement on a hidden panel is all zeroes.
  window.addEventListener('resize', () => {
    if (!panelEl.hidden) placePopover(toggleEl, panelEl, { align })
  })
  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()))
  document.addEventListener('click', (e) => {
    if (panelEl.hidden) return
    if (e.target.closest(wrapSelector) === wrapEl) return
    close()
  }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panelEl.hidden) close() })
  return { open, close }
}
