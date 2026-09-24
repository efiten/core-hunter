import { displayName, GUESS_MARK, isHashIdKind } from './names.js'
// shownName is the name a row shows (displayName, as targetParts prints it)
// without the guess mark: the mark says how sure the name is, not what it is,
// so it is left out where names are compared or sorted. Sorted as a character
// it would put every ~ name ahead of the letters.
function shownName(r) {
  const name = displayName(r)
  return name.startsWith(GUESS_MARK) ? name.slice(GUESS_MARK.length) : name
}

// Kinds that name a directly-heard node, so they can be selected as a target.
// discover_pubkey is a DISCOVER_RESP reply (#129); relay is a last-hop repeater
// attributed via path[last] of a relayed FLOOD packet (see meshpacket.js).
const TARGET_KINDS = new Set(['channel_name', 'advert_pubkey', 'discover_pubkey', 'relay'])

// isTargetKind is that rule for one reception, for surfaces that offer a
// selection outside the list (the HUD's quick actions, #555).
export function isTargetKind(kind) {
  return TARGET_KINDS.has(kind)
}

// Kinds whose id is a hex prefix of the same underlying pubkey space (#267):
// advert carries the full pubkey, discover/relay carry shorter prefixes of
// it. channel_name's id is a decrypted display name, not part of that space,
// and must never be prefix-merged with the others.
const HEX_PREFIX_KINDS = new Set(['advert_pubkey', 'discover_pubkey', 'relay'])

const HEX_ID = /^[0-9a-f]+$/
// 2 bytes is where merging starts (AGENTS.md §7): a 1-byte hash is 1-in-256,
// too coarse to fold rows on. The kinds that carry one are no target kinds and
// never get here; the floor holds for a short id of any kind.
const MIN_MERGE_HEX_CHARS = 4

// Two rows only merge once a name is present on both sides and it matches:
// no name never counts as a match, and a shared prefix alone isn't enough (the
// name is the safety margin against two real nodes that happen to share a
// display name).
function sameResolvedName(a, b) {
  if (!a || !b) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

// placedElsewhere: a reception placed by reach (#661) is that node's, so its
// name is no proof it came from the anchor when two nodes share a name and a
// prefix (#268). It joins only the row of the node it was placed on: the one
// whose pubkey the anchor's id is, or is a prefix of (#625).
function placedElsewhere(rec, anchorId) {
  const attr = rec._attr
  if (!attr || attr.rule !== 'node') return false
  return !attr.node || !String(attr.node.pubkey).toLowerCase().startsWith(anchorId.toLowerCase())
}

// mergePrefixGroups clusters the per-exact-id rows that name the same physical
// node into a single row, keeping the most recent reception as the display
// record. `merged_ids` carries every id in the cluster (lowercased) so a
// target-list selection catches receptions tagged with any prefix variant.
//
// The anchor is the LONGEST id a row is a prefix of, the map's rule (#331,
// web/targetpicker.js). It used to be a full 64-hex pubkey and nothing else,
// and only an advert carries one: a node heard through Discover replies and
// relay hops alone kept a row per id for as long as no advert was in the
// window (#625).
//
// Chained, never transitive (#268). "id A is a prefix of id B" is NOT a
// transitive relation, so it must not be closed over: a 2-byte relay id can be
// a prefix of two different longer ids, and a connected-components pass would
// then place both of those nodes in one cluster. Selecting that row feeds two
// physically separate transmitters into one target's map view, which for a
// direction-finding tool is the wrong answer in the worst possible place.
//
// So a row attaches only when everything longer that it could be is one single
// chain (db11 → db11db → db11db77…), and then to the longest of it. Two longer
// ids that are not prefixes of each other mean the row is as likely the one as
// the other, and it stays on its own. Ambiguity is evidence against merging,
// not for it; that is the same meaning the name resolver's own `ambiguous`
// flag carries. The candidates are counted by prefix ALONE, and the name gate
// applies to the survivor: folding the name into the count makes the refusal
// name-conditioned, which defeats it in exactly the case it exists for, two
// nodes sharing a prefix under different names, where the hop is equally
// likely to have come from either. Two full pubkeys never merge: neither is a
// prefix of the other.
//
// The name gate is the app's, stricter than the map's: both rows show a name
// and it is the same one (Kasper, 2026-09-21). The map merges unnamed rows
// too, because its 8-byte Discover ids carry no name; here a nameless relay
// hop attached to the one longer id in the window would feed another node's
// RSSI into the target. The names compared are the ones the two rows show
// (shownName), so a relay's attribution by reach (#661) decides for its row: a
// collision shows no name, and neither it nor a placement on another node
// merges (Kasper, 2026-09-15), even when that other node shares the anchor's
// name (placedElsewhere). A relay placed on the anchor's own node merges under
// that name, with or without a resolver label.
function mergePrefixGroups(entries) {
  const eligible = entries
    .map(([id, rec], i) => ({ i, id: id.toLowerCase(), rec }))
    .filter((e) => HEX_PREFIX_KINDS.has(e.rec.sender_kind) && e.id.length >= MIN_MERGE_HEX_CHARS && HEX_ID.test(e.id))

  const attachTo = new Map()   // entry index -> entry index of the longest id of its chain
  for (const e of eligible) {
    const longer = eligible.filter((o) => o.id.length > e.id.length && o.id.startsWith(e.id))
    if (!longer.length) continue
    const chained = longer.every((a) => longer.every((b) => a.id.startsWith(b.id) || b.id.startsWith(a.id)))
    if (!chained) continue   // could be either of two nodes: stands alone
    const anchor = longer.reduce((a, b) => (b.id.length > a.id.length ? b : a))
    if (placedElsewhere(e.rec, anchor.id)) continue
    if (!sameResolvedName(shownName(e.rec), shownName(anchor.rec))) continue
    attachTo.set(e.i, anchor.i)
  }

  // An anchor is the longest id of a chain, so it never attaches itself: every
  // group is its anchor plus the rows that point at it.
  const groups = new Map()
  entries.forEach((_, i) => {
    const root = attachTo.has(i) ? attachTo.get(i) : i
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  })

  // Every row in a group shows the anchor's name (the gate above), so the
  // newest one names the merged row, attribution and all.
  return [...groups.values()].map((idxs) => {
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
  return withShownIds(mergePrefixGroups([...bySender.entries()]))
}

// 8 bytes: the longest a row prints. feed.js's rule is that a full-length id is
// never shown, and two keys alike that far are not told apart by eye anyway.
const SHOWN_ID_MAX_HEX_CHARS = 16

// withShownIds gives a row `id_shown` when its 6-hex prefix is also another
// row's while the ids differ (#625): two rows both reading `db11db` look like
// one node listed twice. Each shows two hex more until it stands apart, or
// until its id or the 8 bytes run out, so a short relay hash stays as it is and
// the longer id beside it grows past it. Worked out over every row before the
// list is sorted or cut, so the pinned section and the list print one node the
// same way. Hex ids only: a channel name's id is its text.
function withShownIds(rows) {
  const hex = rows.filter((r) => HEX_PREFIX_KINDS.has(r.sender_kind) && HEX_ID.test(String(r.sender_id).toLowerCase()))
  const byShown = new Map()
  for (const r of hex) {
    const k = idPrefix(r.sender_id).toLowerCase()
    if (!byShown.has(k)) byShown.set(k, [])
    byShown.get(k).push(r)
  }
  const shown = new Map()
  for (const group of byShown.values()) {
    if (group.length < 2) continue
    for (const r of group) {
      const id = String(r.sender_id)
      const others = group.filter((o) => o !== r).map((o) => String(o.sender_id).toLowerCase())
      let n = ID_PREFIX_HEX_CHARS
      const max = Math.min(id.length, SHOWN_ID_MAX_HEX_CHARS)
      while (n < max && others.some((o) => o.slice(0, n) === id.slice(0, n).toLowerCase())) n += 2
      if (n > ID_PREFIX_HEX_CHARS) shown.set(r, id.slice(0, Math.min(n, max)))
    }
  }
  return shown.size ? rows.map((r) => (shown.has(r) ? { ...r, id_shown: shown.get(r) } : r)) : rows
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
  // The name the row shows (targetParts): for a relay that is the attribution
  // by reach of its newest reception (#661), so a name the row refuses to show
  // on a collision is not found either.
  if (rec && displayName(rec).toLowerCase().includes(q)) return true
  return rowIds(rec).some((id) => id.startsWith(q))
}

// senderList sorts deduped senders by name so the target dropdown stays
// stable while signals change. `limit` slices the same sort for lazy-loaded
// batches, and `query` narrows the set BEFORE that slice — paging the matches
// rather than filtering a page, so a match sorting past the first page is
// still reachable.
// The name is the one the row shows (targetParts), so a relay placed on a node
// by reach sorts under that node's name and a refused one under its id (#661).
const sortName = (r) => shownName(r) || String(r.sender_id)
export function senderList(records, { ignore, limit = Infinity, query = '' } = {}) {
  return dedupeSenders(records, ignore)
    .filter((r) => matchesTarget(r, query))
    .sort((a, b) => sortName(a).localeCompare(sortName(b), undefined, { sensitivity: 'base' }))
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
// name-first even before resolution completes. The secondary line is the check
// on a name (#451), so a row without one leaves it empty: the prefix is on the
// first line already, and under itself it said nothing (#640).
export function targetParts(rec) {
  const id = rec.sender_id != null ? String(rec.sender_id) : ''
  // The guess mark on a name resolved for a short prefix (#452), and a relay's
  // attribution by reach before its label (#661): both are names.js's. A row
  // is its newest reception (dedupeSenders), so it reads by that one's.
  const label = displayName(rec)
  if (!id) return { primary: label || '—', secondary: '' }
  const prefix = rec.id_shown || idPrefix(id)
  if (label) return { primary: label, secondary: prefix }
  return { primary: `${prefix} (name not resolved)`, secondary: '' }
}

// rememberTargetName keeps the target chip's name for a selected node key in
// `labels`: the name the node's row shows (displayName, as targetParts), so the
// chip does not name what the row refuses (#661). The HUD and the map popup
// pick a reception rather than a row, so the row in hand decides.
// `fallback` is the name the pick carried, used only when no row claims the
// key. With no name the key is forgotten, and the chip falls back to the id
// prefix instead of a name kept from an earlier pick.
export function rememberTargetName(labels, rows, key, fallback) {
  const row = (rows || []).find((r) => clusterKey(r) === key)
  const name = row ? displayName(row) : String(fallback || '')
  if (name) labels.set(key, name)
  else labels.delete(key)
  return name
}

// refreshTargetNames runs rememberTargetName for every selected key against
// the rows of one tick, keeping a name when no row claims its key. A row
// changes after the pick (the registry lands after start-up, the SF is set on
// connect, the attenuator moves the reach), and the chip follows it (AGENTS.md
// §5.4 item 3). True when a name changed, so the caller paints the chip again.
export function refreshTargetNames(labels, rows, keys) {
  let changed = false
  for (const key of keys || []) {
    const before = labels.get(key)
    rememberTargetName(labels, rows, key, before)
    if (labels.get(key) !== before) changed = true
  }
  return changed
}

// pickName is the name a pick of one reception carries onto the target chip
// (the map popup's Isolate). The selection is the reception's id, and for a
// 1-byte hash that is every reception with that id, wherever each one was
// placed (a hash is no target kind, so no row narrows it). So a hash carries
// '#' and its id, never the node this one reception was placed on (AGENTS.md
// §5.4 item 6); any other kind carries the name it shows.
export function pickName(rec) {
  if (!rec) return ''
  if (isHashIdKind(rec.sender_kind) && rec.sender_id) return '#' + String(rec.sender_id)
  return displayName(rec)
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
// The longest id of the cluster is the identity: that is what anchors it (see
// mergePrefixGroups). With an advert in the window that is the full pubkey,
// which cannot change as prefixes come and go. Without one it is the longest
// prefix heard (#625); it used to be the row's own sender_id, the id of
// whichever reception was newest, so the key of a merged row changed from one
// reception to the next. It still moves once, when a longer id is first heard:
// expandSelection follows that.
export function clusterKey(rec) {
  const ids = (rec && rec.merged_ids) || []
  if (ids.length) return ids.reduce((a, b) => (b.length > a.length ? b : a))
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
    // By key first, then by membership: a key taken before the node's advert
    // was heard is a shorter id of the same chain, and the row's key has since
    // become the pubkey (#625).
    const cluster = (rows || []).find((r) => clusterKey(r) === k)
      || (rows || []).find((r) => (r.merged_ids || []).includes(k))
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

// selectedCompanionIds is the other half of the selection (#576): the targets
// a trace-ping cannot reach. A companion answers only a sender it has as a
// contact, and it adds us when it hears our advert, so these are the nodes the
// self-advert is for each cycle. Defined as the selection minus the repeater
// reading, so the two readings never disagree about one node; a room server or
// a sensor lands here too, which is right, since neither forwards a trace.
//
// The comparison is on full ids, before repeaterIds collapses them onto the
// first byte. That byte is the key only for the trace frame, which a companion
// is never sent: comparing on it dropped a companion that shares its first
// byte with a selected repeater.
export function selectedCompanionIds(records, selectedIds) {
  if (!selectedIds || selectedIds.size === 0) return []
  const repeaters = new Set(repeaterReading(records, (id) => selectedIds.has(id)))
  const out = []
  for (const r of records || []) {
    if (r.sender_id == null) continue
    const id = String(r.sender_id).toLowerCase()
    if (!selectedIds.has(id) || out.includes(id) || repeaters.has(id)) continue
    out.push(id)
  }
  return out
}

// heardRepeaterIds is the same reading over everything heard rather than over a
// selection: the nodes worth trace-pinging when no target is chosen (#479). Same
// per-frame collapse, so the sweep never spends two transmissions on one frame.
export function heardRepeaterIds(records) {
  return repeaterIds(records, () => true)
}

// repeaterReading: every wanted id whose most recent record behaves as a
// repeater, uncollapsed. repeaterIds narrows it to one id per frame;
// selectedCompanionIds needs all of them (#576).
function repeaterReading(records, wanted) {
  const bySender = new Map()
  for (const r of records || []) {
    if (r.sender_id == null) continue
    const id = String(r.sender_id).toLowerCase()
    if (!wanted(id)) continue
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  const out = []
  for (const [id, r] of bySender) {
    // trace_reply (#481) counts as forwarding behaviour: only a node that
    // forwards retransmits a directed trace, and the reply is by construction
    // the newest record for a target we are already pinging. Reading the newest
    // record alone, without this, drops a target from the ping set BECAUSE it
    // answered.
    if (r.sender_role === 'Repeater' || r.sender_kind === 'relay' || r.sender_kind === 'trace_reply') out.push(id)
  }
  return out
}

function repeaterIds(records, wanted) {
  // A trace-ping addresses the node by the first byte of its id (sendTracePing
  // sends id.slice(0, 2)), so every prefix variant of one merged node yields
  // the byte-identical frame. Emitting all of them would spend 2-3x the airtime
  // on duplicate transmissions, against a duty-cycle budget sized for one
  // (#268). Collapse on the byte actually transmitted, keeping the longest id
  // as the representative so the caller still has the most specific form.
  const byFrame = new Map()
  for (const id of repeaterReading(records, wanted)) {
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
