// Hunter adapter helpers for the generalized multi-select picker (#290).
//
// Row content differs from senders: a hunter row is just "name (count)"
// (hunterOptionLabel below) -- no RSSI/time-ago meta. Pinning also differs: a
// hunter has no signal-strength concept, so the Top section is ranked by
// recent activity instead of topSenders' recency+RSSI score -- the most
// recently heard-from hunter, per rx_at on the candidate points (the hunter
// filter dropped, mirroring #223's sender-pool precedent so an already-
// selected hunter doesn't hide a newly-relevant one from the ranking).
//
// hunterOptionLabel lives here rather than filters.js: filters.js is loaded
// both as the versioned top-level entry script (index.html) AND would be
// reachable via an unversioned relative import from here/map.js, which the
// browser's module loader treats as two distinct modules -- duplicating
// every DOM side effect filters.js runs at import time (#f-types chips,
// etc). Keeping this pure helper in a module that is never a top-level
// script avoids that trap entirely.
//
// Pseudonym-aware: guests get `hunter_name` (server-issued "Hunter <N>"
// pseudonym), members+ get the real name; unnamed falls back to an 8-char
// pubkey prefix.
export function hunterOptionLabel(h) {
  return `${h.hunter_name || h.hunter_pubkey.slice(0, 8)} (${h.count})`
}

// dedupeHunterActivity maps each hunter_pubkey seen in the candidate points to
// the most recent rx_at reported for it -- the "last heard from" timestamp
// used to rank the Top section.
export function dedupeHunterActivity(points) {
  const byHunter = new Map()
  for (const r of points || []) {
    if (r.hunter_pubkey == null || r.hunter_pubkey === '') continue
    const id = String(r.hunter_pubkey)
    const prev = byHunter.get(id)
    if (!prev || Date.parse(r.rx_at) > Date.parse(prev)) byHunter.set(id, r.rx_at)
  }
  return byHunter
}

// keptSelection is what survives a roster refetch (#463): the ids the new
// roster still names, in the order they were picked. The roster's ids change
// with the role: a guest picks pseudonym tokens, a member real pubkeys, and a
// hunter sees their own pubkey among the pseudonyms. A token and a pubkey are
// different ids for the same hunter, and the client cannot map one onto the
// other, so a pick the new roster does not name is dropped rather than sent
// as a filter the server would answer with nothing.
export function keptSelection(selected, hunters) {
  const known = new Set((hunters || []).map((h) => String(h.hunter_pubkey)))
  return (selected || []).filter((id) => known.has(String(id)))
}

// hunterList sorts the full hunter roster (from /api/hunters) by label
// (falling back to pubkey prefix, same as hunterOptionLabel), case-
// insensitive, optionally limited for lazy-loaded batches.
export function hunterList(hunters, { limit = Infinity } = {}) {
  return (hunters || [])
    .slice()
    .sort((a, b) => hunterOptionLabel(a).localeCompare(hunterOptionLabel(b), undefined, { sensitivity: 'base' }))
    .slice(0, limit)
}

// topHunters ranks the roster by recent activity in the candidate point set --
// most-recently-heard-from first. A hunter with no activity there is excluded
// rather than pinned behind everyone else: no signal beats an old one, not
// "in some arbitrary order."
export function topHunters(hunters, points, { count = 3 } = {}) {
  const activity = dedupeHunterActivity(points)
  return (hunters || [])
    .filter((hnt) => activity.has(hnt.hunter_pubkey))
    .sort((a, b) => Date.parse(activity.get(b.hunter_pubkey)) - Date.parse(activity.get(a.hunter_pubkey)))
    .slice(0, count)
}

// withoutHunterFilter strips the hunter filter from a filter set -- the
// picker's candidate pool is what you pick FROM, so narrowing it by the
// current hunter selection would shrink the list as you select (mirrors
// targetpicker.js's withoutSenderFilters, the #223/#288 precedent).
export function withoutHunterFilter(filters) {
  const out = {}
  for (const [k, v] of Object.entries(filters || {})) {
    if (k !== 'hunter') out[k] = v
  }
  return out
}
