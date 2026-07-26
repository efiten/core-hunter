// Kinds that name a directly-heard node, so they can be selected as a target.
// discover_pubkey is a DISCOVER_RESP reply (#129); relay is a last-hop repeater
// attributed via path[last] of a relayed FLOOD packet (see meshpacket.js).
const TARGET_KINDS = new Set(['channel_name', 'advert_pubkey', 'discover_pubkey', 'relay'])

// Kinds whose id is a hex prefix of the same underlying pubkey space (#267):
// advert carries the full pubkey, discover/relay carry shorter prefixes of
// it. channel_name's id is a decrypted display name, not part of that space,
// and must never be prefix-merged with the others.
const HEX_PREFIX_KINDS = new Set(['advert_pubkey', 'discover_pubkey', 'relay'])

function isPrefixCompatible(a, b) {
  return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a))
}

// Two rows only merge once a resolved name is present on both sides and it
// matches — an unresolved (null) label never counts as a match, and a shared
// prefix alone isn't enough (the name is the safety margin against two real
// nodes that happen to share a display name).
function sameResolvedName(a, b) {
  if (!a || !b) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

// mergePrefixGroups clusters the per-exact-id rows that name the same
// physical node — same resolved name, and one id is a hex-prefix of the
// other (#267) — into a single row per cluster, keeping the most recent
// reception as the row's display record. `merged_ids` carries every id in
// the cluster (lowercased) so a target-list selection can catch receptions
// tagged with any prefix variant, not just the one currently shown.
function mergePrefixGroups(entries) {
  const parent = entries.map((_, i) => i)
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  function union(i, j) { const ri = find(i); const rj = find(j); if (ri !== rj) parent[ri] = rj }

  for (let i = 0; i < entries.length; i++) {
    const [idI, recI] = entries[i]
    if (!HEX_PREFIX_KINDS.has(recI.sender_kind)) continue
    for (let j = i + 1; j < entries.length; j++) {
      const [idJ, recJ] = entries[j]
      if (!HEX_PREFIX_KINDS.has(recJ.sender_kind)) continue
      if (!isPrefixCompatible(idI.toLowerCase(), idJ.toLowerCase())) continue
      if (!sameResolvedName(recI.sender_label, recJ.sender_label)) continue
      union(i, j)
    }
  }

  const clusters = new Map()
  for (let i = 0; i < entries.length; i++) {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(entries[i])
  }

  return [...clusters.values()].map((group) => {
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

// senderList sorts deduped senders by name so the target dropdown stays
// stable while signals change. `limit` slices the same sort for lazy-loaded
// batches.
export function senderList(records, { ignore, limit = Infinity } = {}) {
  return dedupeSenders(records, ignore)
    .sort((a, b) =>
      String(a.sender_label || a.sender_id).localeCompare(String(b.sender_label || b.sender_id), undefined, { sensitivity: 'base' }))
    .slice(0, limit)
}

// topSenders ranks deduped senders by a combined recency+RSSI score, for the
// pinned section above the alphabetical list. Every 30s since the last
// reception costs roughly 1 dB, so a strong-but-stale sender still loses
// ground to a weaker one heard moments ago.
export function topSenders(records, { ignore, count = 3, nowMs } = {}) {
  const score = (r) => r.rssi - (nowMs - Date.parse(r.rx_at)) / 1000 / 30
  return dedupeSenders(records, ignore)
    .sort((a, b) => score(b) - score(a))
    .slice(0, count)
}

// A node id can be a full 64-char pubkey; only the first 3 bytes are shown so
// the target list never renders (and overlaps on) a full-length hex string.
const ID_PREFIX_HEX_CHARS = 6

function idPrefix(id) {
  return id.slice(0, ID_PREFIX_HEX_CHARS)
}

// targetParts splits a sender row into a primary label and a muted secondary
// prefix for the target list (#178, #215). The byte-prefix is always surfaced
// when a name resolves, so duplicate names and different-length prefixes of
// the same node are distinguishable. Unresolved rows show the prefix plus a
// "name not resolved" marker as the primary line, so every row still reads
// name-first even before resolution completes.
export function targetParts(rec) {
  const id = rec.sender_id != null ? String(rec.sender_id) : ''
  const label = rec.sender_label ? String(rec.sender_label) : ''
  if (!id) return { primary: label || '—', secondary: '' }
  const prefix = idPrefix(id)
  if (label) return { primary: label, secondary: prefix }
  return { primary: `${prefix} (name not resolved)`, secondary: prefix }
}

// selectedRepeaterIds narrows a target selection down to the ids that behave
// as repeaters, per the most recent record for each: either an Advert
// explicitly reported DeviceRole Repeater (sender_role), or the id was only
// ever heard as a relay-kind last-hop (see meshpacket.js). Used to decide
// which selected targets get an auto trace-ping (#233) rather than only the
// broadcast Discover.
export function selectedRepeaterIds(records, selectedIds) {
  if (!selectedIds || selectedIds.size === 0) return []
  const bySender = new Map()
  for (const r of records || []) {
    if (r.sender_id == null) continue
    const id = String(r.sender_id).toLowerCase()
    if (!selectedIds.has(id)) continue
    const prev = bySender.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev.rx_at)) bySender.set(id, r)
  }
  return [...bySender.entries()]
    .filter(([, r]) => r.sender_role === 'Repeater' || r.sender_kind === 'relay')
    .map(([id]) => id)
}

export function relTime(rxAt, nowMs) {
  if (rxAt == null || Number.isNaN(Date.parse(rxAt))) return '—'
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}
