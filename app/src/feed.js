import { displayName } from './names.js'
// Kinds that name a directly-heard node, so they can be selected as a target.
// discover_pubkey is a DISCOVER_RESP reply (#129); relay is a last-hop repeater
// attributed via path[last] of a relayed FLOOD packet (see meshpacket.js).
const TARGET_KINDS = new Set(['channel_name', 'advert_pubkey', 'discover_pubkey', 'relay'])

// Kinds whose id is a hex prefix of the same underlying pubkey space (#267):
// advert carries the full pubkey, discover/relay carry shorter prefixes of
// it. channel_name's id is a decrypted display name, not part of that space,
// and must never be prefix-merged with the others.
const HEX_PREFIX_KINDS = new Set(['advert_pubkey', 'discover_pubkey', 'relay'])

// A full MeshCore pubkey is 32 bytes = 64 hex. Only an advert carries one
// (meshpacket.js); discover and relay ids are shorter prefixes of that space.
const FULL_PUBKEY = /^[0-9a-f]{64}$/

// Two rows only merge once a resolved name is present on both sides and it
// matches — an unresolved (null) label never counts as a match, and a shared
// prefix alone isn't enough (the name is the safety margin against two real
// nodes that happen to share a display name).
function sameResolvedName(a, b) {
  if (!a || !b) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

// mergePrefixGroups clusters the per-exact-id rows that name the same physical
// node into a single row, keeping the most recent reception as the display
// record. `merged_ids` carries every id in the cluster (lowercased) so a
// target-list selection catches receptions tagged with any prefix variant.
//
// Anchored, never transitive (#268). "id A is a prefix of id B" is NOT a
// transitive relation, so it must not be closed over: a 2-byte relay id can be
// a prefix of two different full pubkeys, and a connected-components pass would
// then place both of those nodes in one cluster. Selecting that row feeds two
// physically separate transmitters into one target's map view, which for a
// direction-finding tool is the wrong answer in the worst possible place.
//
// So each prefix attaches to at most ONE anchor — a full 64-hex pubkey with a
// matching resolved name — and a prefix that matches two or more anchors stays
// on its own row. Ambiguity is evidence against merging, not for it; that is
// the same meaning the name resolver's own `ambiguous` flag carries. Anchors
// never merge with each other: two distinct full pubkeys are two nodes by
// definition. The pass is O(n·k) in anchors rather than O(n²).
function mergePrefixGroups(entries) {
  const anchors = []      // indices of full-pubkey rows
  const attached = new Map()  // anchor index -> [entry indices]
  const solo = []         // indices that stand alone

  // Seed every anchor before the attach pass, so a prefix that appears earlier
  // in the input than its anchor still finds a bucket (order independence).
  entries.forEach(([id, rec], i) => {
    if (HEX_PREFIX_KINDS.has(rec.sender_kind) && FULL_PUBKEY.test(id.toLowerCase())) {
      anchors.push(i)
      attached.set(i, [i])
    }
  })

  entries.forEach(([id, rec], i) => {
    if (attached.has(i)) return   // an anchor never attaches to another anchor
    const lower = id.toLowerCase()
    if (!HEX_PREFIX_KINDS.has(rec.sender_kind)) { solo.push(i); return }
    // Count by prefix ALONE, then apply the name gate to the survivor. Folding
    // sameResolvedName into the count makes the refusal name-conditioned, which
    // defeats it in exactly the case it exists for: two anchors sharing a
    // prefix under different names (say a1b2c3d4… "Zuid" and a1b2ffff… "Noord")
    // leave a relay hop a1b2 matching only one of them, so it attaches — even
    // though the hop is equally likely to have come from the other. The
    // resolver cannot rescue that either: it answers unambiguously whenever it
    // knows only one of the two.
    const matches = anchors.filter((a) => entries[a][0].toLowerCase().startsWith(lower))
    if (matches.length === 1 && sameResolvedName(rec.sender_label, entries[matches[0]][1].sender_label)) {
      attached.get(matches[0]).push(i)
    } else solo.push(i)   // 0 anchors, ambiguous across 2+, or the name disagrees
  })

  const groups = [...attached.values(), ...solo.map((i) => [i])]
  return groups.map((idxs) => {
    const group = idxs.map((i) => entries[i])
    const merged_ids = group.map(([id]) => id.toLowerCase()).sort()
    const [, best] = group.reduce((a, b) => (Date.parse(b[1].rx_at) > Date.parse(a[1].rx_at) ? b : a))
    return { ...best, merged_ids }
  })
}

// dedupeSenders collapses receptions into one row per heard sender, keeping
// the most recent reception for each, then merges rows that are prefix-
// compatible variants of the same physical node (#267). Used as the basis
// for both the alphabetical list and the recency/RSSI-ranked pinned section.
function dedupeSenders(records, ignore) {
  const ig = ignore || new Set()
  const bySender = new Map()
  for (const r of records || []) {
    if (!TARGET_KINDS.has(r.sender_kind)) continue
    if (r.sender_id == null) continue
    const id = String(r.sender_id)
    if (ig.has(id.toLowerCase())) continue
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  return mergePrefixGroups([...bySender.entries()])
}

// rowIds lists the lowercased ids a target row answers to. A row from
// senderList/topSenders always carries merged_ids (#267) — every prefix-
// compatible variant merged into this node — and a row built outside
// dedupeSenders falls back to its bare sender_id.
export function rowIds(rec) {
  const merged = rec && rec.merged_ids
  if (Array.isArray(merged) && merged.length) return merged.map((id) => String(id).toLowerCase())
  return rec && rec.sender_id != null ? [String(rec.sender_id).toLowerCase()] : []
}

// matchesTarget is the search rule behind the target sheet's field (#449):
// a row matches when the query appears anywhere in its resolved name, or when
// any of its ids STARTS with the query. The two halves are deliberately
// different. A name is read as words, so the middle of it is worth finding;
// an id is read from the front — it is the prefix that the HUD, the ticker
// and every popup print (idPrefix), so the front is the only part a user can
// type from memory. Matching an id substring would make a 2-byte query find
// most of the ids on screen, which is the opposite of narrowing.
//
// An empty (or whitespace-only) query matches everything, so the caller can
// pass the raw field value and get today's unfiltered list back.
export function matchesTarget(rec, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase()
  if (!q) return true
  const label = rec && rec.sender_label ? String(rec.sender_label).toLowerCase() : ''
  if (label.includes(q)) return true
  return rowIds(rec).some((id) => id.startsWith(q))
}

// senderList sorts deduped senders by name so the target dropdown stays
// stable while signals change. `limit` slices the same sort for lazy-loaded
// batches, and `query` narrows the set BEFORE that slice — paging the matches
// rather than filtering a page, so a match sorting past the first page is
// still reachable.
export function senderList(records, { ignore, limit = Infinity, query = '' } = {}) {
  return dedupeSenders(records, ignore)
    .filter((r) => matchesTarget(r, query))
    .sort((a, b) =>
      String(a.sender_label || a.sender_id).localeCompare(String(b.sender_label || b.sender_id), undefined, { sensitivity: 'base' }))
    .slice(0, limit)
}

// topSenders ranks deduped senders by a combined recency+RSSI score, for the
// pinned section above the alphabetical list. Every 30s since the last
// reception costs roughly 1 dB, so a strong-but-stale sender still loses
// ground to a weaker one heard moments ago.
//
// Empty when everything would be pinned (#539): with `count` or fewer senders
// heard, Top is the full list re-sorted — a duplicate, not a shortlist — so
// the section reports nothing and the caller hides it.
export function topSenders(records, { ignore, count = 3, nowMs } = {}) {
  const score = (r) => r.rssi - (nowMs - Date.parse(r.rx_at)) / 1000 / 30
  const rows = dedupeSenders(records, ignore)
  if (rows.length <= count) return []
  return rows
    .sort((a, b) => score(b) - score(a))
    .slice(0, count)
}

// A node id can be a full 64-char pubkey; only the first 3 bytes are shown so
// the target list never renders (and overlaps on) a full-length hex string.
const ID_PREFIX_HEX_CHARS = 6

// Exported so every surface that has to render an unresolved id uses the same
// short form — feed.js's own rule is that a full-length id is never shown.
export function idPrefix(id) {
  return String(id || '').slice(0, ID_PREFIX_HEX_CHARS)
}

// targetParts splits a sender row into a primary label and a muted secondary
// prefix for the target list (#178, #215). The byte-prefix is always surfaced
// when a name resolves, so duplicate names and different-length prefixes of
// the same node are distinguishable. Unresolved rows show the prefix plus a
// "name not resolved" marker as the primary line, so every row still reads
// name-first even before resolution completes.
export function targetParts(rec) {
  const id = rec.sender_id != null ? String(rec.sender_id) : ''
  // The guess mark on a name resolved for a short prefix (#452, names.js).
  const label = rec.sender_label ? displayName(rec) : ''
  if (!id) return { primary: label || '—', secondary: '' }
  const prefix = idPrefix(id)
  if (label) return { primary: label, secondary: prefix }
  return { primary: `${prefix} (name not resolved)`, secondary: prefix }
}

// clusterKey names the NODE a target-list row stands for, stably across
// changes to which ids it is currently known by (#268).
//
// A selection stored as the ids a row happened to carry at tap time is a
// snapshot: when the node is later heard under a new variant — its first
// DISCOVER_RESP prefix, say — that reception falls outside the stored set and
// disappears from the map, while the row still renders checked.
// Silently dropping receptions for the node being hunted is the failure a user
// is least likely to notice.
//
// The full pubkey is the identity when the cluster has one, because that is
// what anchors it (see mergePrefixGroups) and it cannot change as prefixes
// come and go. A row with no anchor stands only for itself.
export function clusterKey(rec) {
  const ids = (rec && rec.merged_ids) || []
  const anchor = ids.find((id) => FULL_PUBKEY.test(id))
  if (anchor) return anchor
  return String((rec && rec.sender_id) || '').toLowerCase()
}

// selectionKeyFor picks the key a tap on `id` should select, given the rows in
// hand. It is the counterpart to expandSelection: that turns keys back into
// ids, this turns an id into the key.
//
// Callers do not all know the cluster. The target list passes the row's whole
// merged_ids group; the map popup has only the one sender_id it drew (#297).
// Keying off the raw id in that second case selected a single variant while the
// list rendered the whole cluster as checked, and a later tap on that row
// computed the anchor — a different key — so it added a second selection
// instead of clearing the first. Resolving against the current rows makes both
// callers agree without either needing to know about the other.
export function selectionKeyFor(rows, id, ids) {
  const wanted = String(id || '').toLowerCase()
  if (!wanted) return ''
  const cluster = (rows || []).find((r) => (r.merged_ids || []).includes(wanted))
  if (cluster) return clusterKey(cluster)
  const group = Array.isArray(ids) && ids.length ? ids.map((x) => String(x).toLowerCase()) : [wanted]
  return clusterKey({ sender_id: wanted, merged_ids: group })
}

// expandSelection turns selected node keys into the id set to filter on right
// now, by re-deriving each node's current cluster from the rows in hand.
//
// A key with no matching cluster expands to itself: the node may simply not
// have been heard in this window, and the selection must survive that rather
// than silently emptying.
export function expandSelection(keys, rows) {
  const out = new Set()
  for (const key of keys || []) {
    const k = String(key).toLowerCase()
    const cluster = (rows || []).find((r) => clusterKey(r) === k)
    if (cluster) for (const id of cluster.merged_ids || []) out.add(id)
    else out.add(k)
  }
  return out
}

// selectedRepeaterIds narrows a target selection down to the ids that behave
// as repeaters, per the most recent record for each: either an Advert
// explicitly reported DeviceRole Repeater (sender_role), or the id was only
// ever heard as a relay-kind last-hop (see meshpacket.js). Used to decide
// which selected targets get an auto trace-ping (#233) rather than only the
// broadcast Discover.
export function selectedRepeaterIds(records, selectedIds) {
  if (!selectedIds || selectedIds.size === 0) return []
  return repeaterIds(records, (id) => selectedIds.has(id))
}

// heardRepeaterIds is the same reading over everything heard rather than over a
// selection: the nodes worth trace-pinging when no target is chosen (#479). Same
// per-frame collapse, so the sweep never spends two transmissions on one frame.
export function heardRepeaterIds(records) {
  return repeaterIds(records, () => true)
}

function repeaterIds(records, wanted) {
  const bySender = new Map()
  for (const r of records || []) {
    if (r.sender_id == null) continue
    const id = String(r.sender_id).toLowerCase()
    if (!wanted(id)) continue
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  // A trace-ping addresses the node by the first byte of its id (sendTracePing
  // sends id.slice(0, 2)), so every prefix variant of one merged node yields
  // the byte-identical frame. Emitting all of them would spend 2-3x the airtime
  // on duplicate transmissions, against a duty-cycle budget sized for one
  // (#268). Collapse on the byte actually transmitted, keeping the longest id
  // as the representative so the caller still has the most specific form.
  const byFrame = new Map()
  for (const [id, r] of bySender) {
    // trace_reply (#481) counts as forwarding behaviour: only a node that
    // forwards retransmits a directed trace, and the reply is by construction
    // the newest record for a target we are already pinging. Reading the newest
    // record alone, without this, drops a target from the ping set BECAUSE it
    // answered.
    if (!(r.sender_role === 'Repeater' || r.sender_kind === 'relay' || r.sender_kind === 'trace_reply')) continue
    const frame = id.slice(0, 2)
    const prev = byFrame.get(frame)
    if (!prev || id.length > prev.length) byFrame.set(frame, id)
  }
  return [...byFrame.values()]
}

export function relTime(rxAt, nowMs) {
  if (rxAt == null || Number.isNaN(Date.parse(rxAt))) return '—'
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}
