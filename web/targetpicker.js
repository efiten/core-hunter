// Target-list picker (#223) — browsable, multi-select parity with app's
// target sheet (app/src/targetlist.js, app/src/feed.js). Not ported directly:
// per the issue, "app/src/feed.js as reference for behaviour, not code to
// port directly — web's data model, historical vs. live, differs". Web has
// no local capture store or sender_kind-based target-eligibility gate (a
// BLE-capture-classification concept, meshpacket.js) — the data source here
// is whatever points the map's current filters already fetched, and every
// sender_id present is eligible, not just "target kinds". sender_kind is
// consulted for one thing only: which ids live in the pubkey namespace and may
// therefore be prefix-merged (see mergePrefixGroups).

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Kinds whose sender_id lives in the pubkey namespace, so one can be a hex
// prefix of another. Lengths seen in the live window, not assumed: an advert
// carries the full 32-byte key; a discover reply carries 8 bytes (16 hex) or the
// full key, never 3; a relay path element carries a 1-3 byte path hash.
// channel_name's id is a decrypted display name — arbitrary operator text of any
// length, never prefix-merged. The rule below only needs "longer and starts
// with", so it holds for any of these lengths.
const HEX_PREFIX_KINDS = new Set(['advert_pubkey', 'discover_pubkey', 'relay'])
const HEX_ID = /^[0-9a-f]+$/
// 2 bytes is where merging starts: a 1-byte path hash is 1-in-256, far too
// coarse to attribute to a node just because one candidate happens to be in the
// window.
const MIN_MERGE_HEX_CHARS = 4

// Two rows are name-incompatible only when BOTH resolve and disagree — that is
// positive evidence of two nodes. An unresolved side says nothing either way,
// unlike the app (feed.js), which requires a matching name on both sides before
// merging.
//
// The app's stricter gate would not fix #331 here, but not because names are
// absent: `sender_label` is NOT only set by an advert. The repeater-name backfill
// writes it onto short prefixes too, so in the live window ~19% of 2-byte and
// ~20% of 3-byte relay ids carry one, while the largest long-id population —
// 8-byte discover ids — carries none. A both-sides-must-match gate would merge
// the labelled minority and leave the ~200 unlabelled prefix rows that #331 is
// actually about. So the gate stays loose, and disagreement is what refuses.
const norm = (s) => String(s || '').trim().toLowerCase()
function namesCompatible(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return true
  return x === y
}

// mergePrefixGroups collapses the rows that name one physical node — a full
// advert pubkey plus the shorter prefixes the same node is heard under — into a
// single row, so the list reads one row per node (#331; the app's equivalent is
// feed.js mergePrefixGroups, #267/#268).
//
// Each id attaches to the LONGEST id it is a prefix of, but only when
// everything longer that it could be is one single chain (e.g. 4a4a → 4a4abe →
// 4a4abe11…). If two candidates exist that are not prefixes of each other —
// say 4a4abe11… and 4a4aff… — then 4a4a is equally likely to be either, and it
// stays on its own row. Ambiguity is evidence against merging, not for it: this
// is a direction-finding tool, and feeding two physically separate transmitters
// to Locate as one target is the wrong answer in the worst possible place.
//
// Two full pubkeys never merge: neither is a prefix of the other, so the rule
// above already leaves them apart. Note the residual risk this cannot see —
// a prefix whose true owner never adverted in the window attaches to the one
// candidate that is there. That is inherent to prefix attribution; the merge
// only ever claims what the window can support.
//
// The merged row keeps the newest reception (so RSSI and age stay live) but is
// named by the cluster's longest id, and by the name on the longest member that
// has one. `merged_ids` carries every id it was built from, lowercased, so the
// selection can filter on all of them at once.
function mergePrefixGroups(entries) {
  const eligible = entries
    .map(([id, rec], i) => ({ i, id: id.toLowerCase(), rec }))
    .filter((e) => HEX_PREFIX_KINDS.has(e.rec.sender_kind)
      && e.id.length >= MIN_MERGE_HEX_CHARS && HEX_ID.test(e.id))

  // Bucket by the first 2 bytes: a prefix relation implies a shared leading
  // 4 hex chars, so candidates never have to be searched outside the bucket.
  const buckets = new Map()
  for (const e of eligible) {
    const k = e.id.slice(0, MIN_MERGE_HEX_CHARS)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(e)
  }

  const attachTo = new Map()   // entry index -> entry index of a longer id
  for (const e of eligible) {
    const longer = buckets.get(e.id.slice(0, MIN_MERGE_HEX_CHARS))
      .filter((o) => o.id.length > e.id.length && o.id.startsWith(e.id))
    if (!longer.length) continue
    const chained = longer.every((a) => longer.every((b) => a.id.startsWith(b.id) || b.id.startsWith(a.id)))
    if (!chained) continue     // could be either of two nodes -> stands alone
    const target = longer.reduce((a, b) => (b.id.length > a.id.length ? b : a))
    if (!namesCompatible(e.rec.sender_label, target.rec.sender_label)) continue
    attachTo.set(e.i, target.i)
  }

  // Follow each chain to its root. attachTo always points at a strictly longer
  // id, so the walk terminates.
  const groups = new Map()
  entries.forEach((_, i) => {
    let root = i
    while (attachTo.has(root)) root = attachTo.get(root)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  })

  const rows = []
  for (const idxs of groups.values()) {
    const group = idxs.map((i) => entries[i])

    // namesCompatible above is only ever evaluated against the LONGEST candidate,
    // never between members. When that longest id is unlabelled it is compatible
    // with everything, so two members carrying *different* names each pass and
    // still meet in one group. Since labels do occur on short prefixes and the
    // common long id (8-byte discover) has none, that is the ordinary shape here,
    // not a corner. So the assembled group is checked as a whole, and a group
    // whose names are not unanimous is not merged at all: which member the prefix
    // belongs to is precisely what is in doubt, and ambiguity is evidence against
    // merging. Every member goes back to its own row rather than picking a winner.
    const names = new Set(group.map(([, r]) => norm(r.sender_label)).filter(Boolean))
    if (names.size > 1) {
      for (const [id, rec] of group) rows.push({ ...rec, sender_id: id, merged_ids: [id.toLowerCase()] })
      continue
    }

    // Longest id first, so the label is taken from the strongest evidence in the
    // group: a name on a full advert pubkey came from the advert itself, one on a
    // 2-byte prefix is a backfilled unique-match guess. Scanning in group order
    // instead chose between them by which reception happened to arrive first.
    const byLongest = [...group].sort((a, b) => b[0].length - a[0].length)
    const merged_ids = group.map(([id]) => id.toLowerCase()).sort()
    const [canonical] = byLongest[0]
    const [, newest] = group.reduce((a, b) => (Date.parse(b[1].rx_at) > Date.parse(a[1].rx_at) ? b : a))
    const label = byLongest.map(([, r]) => r.sender_label).find((l) => norm(l)) || newest.sender_label
    rows.push({ ...newest, sender_id: canonical, sender_label: label, merged_ids })
  }
  return rows
}

// dedupeSenders collapses receptions into one row per sender_id, keeping the
// most recent (by rx_at) for each, then merges the rows that are prefix
// variants of one node (see mergePrefixGroups).
export function dedupeSenders(points) {
  const bySender = new Map()
  for (const r of points || []) {
    if (r.sender_id == null || r.sender_id === '') continue
    const id = String(r.sender_id)
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  return mergePrefixGroups([...bySender.entries()])
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

// The key currentFilters() carries both sender inputs under (see senderParams).
export const SENDER_FILTER_KEY = 'senderPairs'

// withoutSenderFilters strips the sender inputs from a filter set. The picker's
// candidate pool is what you pick FROM, so narrowing it by the current pick
// would shrink the list as you select, and would refetch on every click — the
// pool is sender-independent by construction (#288). Both the selection and the
// typed prefix travel under one key, so one exclusion covers them together.
//
// A named export rather than an inline `k !== '...'` at the call site: that key
// was renamed once already, and the stale literal left behind kept the cache
// invalidating on every selection change without anything failing.
export function withoutSenderFilters(filters) {
  const out = {}
  for (const [k, v] of Object.entries(filters || {})) {
    if (k !== SENDER_FILTER_KEY) out[k] = v
  }
  return out
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
// The row builder, paging, pinned section, and picker state are generic
// (#290) -- lifted into multiselect.js so any "pick several of these" control
// shares one pattern. Only the sender-specific adapter lives here.

import { createMultiSelectPicker } from './multiselect.js'

const PINNED_COUNT = 3

// The ids one row filters on. A merged row stands for a node heard under
// several prefixes, and a later reception may arrive under any of them, so the
// row carries all of them rather than only the id it is labelled with (#331).
function rowIds(rec) {
  const merged = (rec.merged_ids || []).filter(Boolean)
  if (merged.length) return merged
  const id = rec.sender_id != null ? String(rec.sender_id).toLowerCase() : ''
  return id ? [id] : []
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

  const adapter = {
    // A merged row is one target across several prefixes (#331), so it reports
    // its whole id group and the component selects/deselects it as a unit.
    idsOf: rowIds,
    rowParts: (rec, nowMs) => {
      const { primary, secondary } = targetParts(rec)
      return { primary, secondary, meta: [
        { text: String(rec.rssi ?? '—'), cls: 'tl-rssi' },
        { text: relTime(rec.rx_at, nowMs), cls: 'tl-time' },
      ] }
    },
    // What a rendered row depends on. merged_ids is part of it: a new reception
    // under a prefix the node was not yet known by changes the group the row
    // toggles, without necessarily changing the newest reception it displays.
    sigOf: (r) => (r.sender_label || r.sender_id || '') + r.rssi + r.rx_at + '/' + rowIds(r).join(','),
    list: (points, { limit } = {}) => senderList(points, { limit }),
    pinned: (points, { count, nowMs }) => topSenders(points, { count, nowMs }),
    // A typed prefix and an exact pick are different match kinds, so picking
    // clears the box rather than silently intersecting the two.
    onPick: (selected) => {
      if (selected.size && input.value.trim()) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    },
  }

  return createMultiSelectPicker(adapter, listEl, { pinnedEl, onChange, pinnedCount: PINNED_COUNT })
}
