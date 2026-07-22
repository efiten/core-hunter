// Target-list picker (#223) — browsable, multi-select parity with app's
// target sheet (app/src/targetlist.js, app/src/feed.js). Not ported directly:
// per the issue, "app/src/feed.js as reference for behaviour, not code to
// port directly — web's data model, historical vs. live, differs". Web has
// no local capture store or sender_kind-based target-eligibility gate (a
// BLE-capture-classification concept, meshpacket.js) — the data source here
// is whatever points the map's current filters already fetched, and every
// sender_id present is eligible, not just "target kinds".

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// dedupeSenders collapses receptions into one row per sender_id, keeping the
// most recent (by rx_at) for each.
export function dedupeSenders(points) {
  const bySender = new Map()
  for (const r of points || []) {
    if (r.sender_id == null || r.sender_id === '') continue
    const id = String(r.sender_id)
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  return [...bySender.values()]
}

// senderList sorts deduped senders by name (falling back to id), case-
// insensitive, optionally limited for lazy-loaded batches.
export function senderList(points, { limit = Infinity } = {}) {
  return dedupeSenders(points)
    .sort((a, b) =>
      String(a.sender_label || a.sender_id).localeCompare(String(b.sender_label || b.sender_id), undefined, { sensitivity: 'base' }))
    .slice(0, limit)
}

// topSenders ranks deduped senders by a combined recency+RSSI score, for a
// pinned section above the alphabetical list -- same formula as app's
// feed.js: every 30s since the last reception costs roughly 1dB, so a
// strong-but-stale sender still loses ground to a weaker one heard moments ago.
export function topSenders(points, { count = 3, nowMs } = {}) {
  const score = (r) => r.rssi - (nowMs - Date.parse(r.rx_at)) / 1000 / 30
  return dedupeSenders(points)
    .sort((a, b) => score(b) - score(a))
    .slice(0, count)
}

const ID_PREFIX_HEX_CHARS = 6
const idPrefix = (id) => id.slice(0, ID_PREFIX_HEX_CHARS)

// targetParts splits a sender row into a primary label and a muted secondary
// byte-prefix, so duplicate names / different-length prefixes of the same
// node stay distinguishable, same idea as app's feed.js.
export function targetParts(rec) {
  const id = rec.sender_id != null ? String(rec.sender_id) : ''
  const label = rec.sender_label ? String(rec.sender_label) : ''
  if (!id) return { primary: label || '—', secondary: '' }
  const prefix = idPrefix(id)
  if (label) return { primary: label, secondary: prefix }
  return { primary: `${prefix} (name not resolved)`, secondary: prefix }
}

// relTime — ported from app/src/feed.js (not shared: see module docstring).
export function relTime(rxAt, nowMs) {
  if (rxAt == null || Number.isNaN(Date.parse(rxAt))) return '—'
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}

// parseSenderField disambiguates the reused #f-sender value (#223 decision:
// the picker and the existing free-text prefix search share one field/param
// rather than a separate one). A comma means "exact-id multi-select from the
// picker"; anything else is the pre-existing single leading-prefix search,
// unchanged.
export function parseSenderField(value) {
  const v = (value || '').trim()
  if (!v) return { mode: 'none' }
  if (v.includes(',')) {
    const ids = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    return { mode: 'ids', ids }
  }
  return { mode: 'prefix', prefix: v }
}

// senderQueryParam is what actually goes to the server's sender= param. The
// server only does a single leading-prefix LIKE match
// (server/internal/store/query.go) -- it cannot OR multiple exact ids. A
// multi-select must NOT be forwarded there (it would prefix-match the
// literal joined string and return nothing); ids-mode filtering happens
// client-side instead, via matchesSenderIds, after a broader fetch.
export function senderQueryParam(value) {
  const parsed = parseSenderField(value)
  return parsed.mode === 'prefix' ? parsed.prefix : ''
}

// matchesSenderIds — client-side exact-id filter for the multi-select case.
export function matchesSenderIds(pt, ids) {
  if (pt.sender_id == null) return false
  return ids.includes(String(pt.sender_id).toLowerCase())
}

// toggleSenderId toggles one id within an already-ids-mode comma-joined
// selection. It is not responsible for deciding whether a bare field value
// should seed the picker's selection in the first place -- that decision
// (comma present -> seed from it; no comma -> start empty rather than guess
// whether a bare value was a typed prefix or an earlier single pick, which
// are genuinely indistinguishable as one string) belongs to the DOM
// component, once, at creation/reload time. See createTargetPicker.
export function toggleSenderId(currentIdsCsv, id) {
  const ids = currentIdsCsv ? currentIdsCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
  const key = String(id).toLowerCase()
  const i = ids.indexOf(key)
  if (i >= 0) ids.splice(i, 1); else ids.push(key)
  return ids.join(',')
}

// ---------------------------------------------------------------------------
// DOM component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 6
const PINNED_COUNT = 3

function row(rec, nowMs, selectedIds, onToggle) {
  const li = document.createElement('li')
  li.className = 'tl-item'

  const id = rec.sender_id != null ? String(rec.sender_id) : ''
  const selected = !!(id && selectedIds.has(id.toLowerCase()))

  const btn = document.createElement('button')
  btn.type = 'button'; btn.className = 'tl-row'
  btn.classList.toggle('active', selected)
  btn.setAttribute('aria-pressed', String(selected))

  const check = document.createElement('span'); check.className = 'tl-check'; check.setAttribute('aria-hidden', 'true')

  const { primary, secondary } = targetParts(rec)
  const name = document.createElement('span'); name.className = 'tl-name'; name.textContent = primary

  const meta = document.createElement('span'); meta.className = 'tl-meta'
  if (secondary) {
    const prefix = document.createElement('span'); prefix.className = 'tl-prefix'; prefix.textContent = secondary
    meta.appendChild(prefix)
  }
  const rssi = document.createElement('span'); rssi.className = 'tl-rssi'; rssi.textContent = String(rec.rssi ?? '—')
  const time = document.createElement('span'); time.className = 'tl-time'; time.textContent = relTime(rec.rx_at, nowMs)
  meta.append(rssi, time)

  btn.append(check, name, meta)
  btn.addEventListener('click', () => id && onToggle(id))

  li.appendChild(btn)
  return li
}

// createTargetPicker builds the browsable multi-select dropdown for
// `senderInputId` (#f-sender). The field stays the single source of truth
// for both the typed prefix search (unchanged) and the picker's exact-id
// selection (#223) -- picking from the list writes a comma-joined id list
// back into it and dispatches 'input' so the existing urlstate binding and
// filter-change wiring (filters.js) pick it up with no changes there.
export function createTargetPicker(senderInputId, listEl, { pinnedEl } = {}) {
  const input = document.getElementById(senderInputId)
  let visible = PAGE_SIZE
  let lastPoints = []
  let _lastSig = null
  let _lastPinnedSig = null

  // The picker's own live selection. Session-persistent (a plain Set, not
  // re-derived from the field string on every call) so multiple clicks
  // accumulate correctly -- a single previously-picked id, once written back
  // as a bare comma-less value, is indistinguishable from a typed prefix
  // (#223's own "distinctly from a manually-typed prefix" concern), so
  // re-parsing on every render would silently drop it back to empty after
  // exactly one click. Resynced from the field only when something ELSE
  // changed it (Clear, manual typing, a urlstate/shared-link restore) --
  // detected by comparing the field's current value against what this Set
  // would itself produce, rather than a set/echo flag around our own writes.
  let selectedIds = new Set()

  function resyncIfExternallyChanged() {
    const mine = [...selectedIds].join(',')
    if (input.value === mine) return
    const parsed = parseSenderField(input.value)
    selectedIds = new Set(parsed.mode === 'ids' ? parsed.ids : [])
  }

  function onToggle(id) {
    input.value = toggleSenderId([...selectedIds].join(','), id)
    selectedIds = new Set(input.value ? input.value.split(',') : [])
    input.dispatchEvent(new Event('input', { bubbles: true }))
    render(lastPoints, Date.now())
  }

  function render(points, nowMs) {
    lastPoints = points || []
    resyncIfExternallyChanged()
    const selKey = [...selectedIds].sort().join(',')

    if (pinnedEl) {
      const pinned = topSenders(lastPoints, { count: PINNED_COUNT, nowMs })
      const pinnedSig = pinned.map((r) => (r.sender_label || r.sender_id || '') + r.rssi + r.rx_at).join('|') + '@' + selKey
      if (pinnedSig !== _lastPinnedSig) {
        _lastPinnedSig = pinnedSig
        pinnedEl.replaceChildren(...pinned.map((rec) => row(rec, nowMs, selectedIds, onToggle)))
      }
    }

    const items = senderList(lastPoints, { limit: visible })
    const sig = items.map((r) => (r.sender_label || r.sender_id || '') + r.rssi + r.rx_at).join('|') + '#' + visible + '@' + selKey
    if (sig === _lastSig) return
    _lastSig = sig
    listEl.replaceChildren(...items.map((rec) => row(rec, nowMs, selectedIds, onToggle)))
  }

  function reset() {
    visible = PAGE_SIZE
    _lastSig = null
    _lastPinnedSig = null
  }

  listEl.addEventListener('scroll', () => {
    if (listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 24) return
    const total = senderList(lastPoints).length
    if (visible >= total) return
    visible += PAGE_SIZE
    _lastSig = null
    render(lastPoints, Date.now())
  })

  return { render, reset }
}
