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

// senderParams maps the two independent sender inputs — the picker's selected
// ids and the typed prefix — onto the query params that carry them (#223):
// exact picks as a REPEATED ?senders=, a typed prefix as ?sender=. Nothing is
// delimiter-joined, so an id may contain any character, which matters because
// sender_id is the decrypted display name for channel_name senders, i.e.
// arbitrary operator text (#288).
//
// A selection wins over a typed prefix: they are different match kinds (exact
// vs leading-prefix) and silently intersecting them would be surprising.
export function senderParams({ ids, prefix } = {}) {
  if (ids && ids.length) return ids.map((id) => ['senders', id])
  const p = String(prefix || '').trim()
  return p ? [['sender', p]] : []
}

// The picker's selection is its own state, so it carries its own encoding for
// the shareable URL and localStorage. It cannot be delimiter-joined for the
// same reason the query params can't be, so it goes as JSON. A corrupt or
// hand-edited value decodes to "nothing selected" rather than throwing during
// boot — urlstate runs before the map is drawn, so a throw here is a blank page.
export function encodeSelection(ids) {
  return ids && ids.length ? JSON.stringify(ids) : ''
}

export function decodeSelection(raw) {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((x) => typeof x === 'string' && x.trim())
  } catch (_) { return [] }
}

// ---------------------------------------------------------------------------
// DOM component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 12
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

// createTargetPicker builds the browsable multi-select dropdown.
//
// The picker owns its selection (#288). It used to write a delimiter-joined id
// list back into #f-sender and treat that field as the single source of truth
// for both filters at once. That cannot represent the data: sender_id is the
// decrypted display name for channel_name senders, so it is arbitrary operator
// text, and a node named "Bob; K." was indistinguishable from two nodes "Bob"
// and "K." -- whichever delimiter was chosen. Picking a real sender could
// therefore select something else entirely, or nothing.
//
// So #f-sender is the typed leading-prefix search and nothing else, and the
// selection lives here as a Set. onChange fires whenever it moves, so map.js
// can refresh and persist without this module knowing about either.
export function createTargetPicker(senderInputId, listEl, { pinnedEl, onChange } = {}) {
  const input = document.getElementById(senderInputId)
  const selected = new Set()
  let visible = PAGE_SIZE
  let lastPoints = []
  let _lastSig = null
  let _lastPinnedSig = null

  const currentIds = () => selected

  function onToggle(id) {
    const key = String(id).toLowerCase()
    if (selected.has(key)) selected.delete(key); else selected.add(key)
    // A typed prefix and an exact pick are different match kinds, so picking
    // clears the box rather than silently intersecting the two.
    if (selected.size && input.value.trim()) {
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (onChange) onChange()
    render(lastPoints, Date.now())
  }

  function render(points, nowMs) {
    lastPoints = points || []
    const selectedIds = currentIds()
    const selKey = JSON.stringify([...selectedIds].sort())

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

  // Selection accessors for urlstate (map.js) and the clear-filters path.
  const getSelected = () => [...selected]
  function setSelected(ids) {
    selected.clear()
    for (const id of ids || []) if (typeof id === 'string' && id.trim()) selected.add(id.toLowerCase())
    render(lastPoints, Date.now())
  }

  return {
    getSelected, setSelected, render, reset }
}
