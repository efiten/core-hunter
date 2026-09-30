// Client-side node-name resolution for the analysis map. Each distinct pubkey /
// pubkey-prefix is fetched from the same-origin resolve proxy at most once and
// cached. Resolvable = a full 32-byte pubkey (advert) OR a >= 4-byte prefix
// (discover reply) — the resolver resolves those uniquely. 1-byte source/path
// hashes (2 hex) are ambiguous and skipped.
import { API_BASE } from './config.js'

// key (lowercase hex) -> { name: string|null, pos: {lat, lon} | null }.
// The resolve proxy returns the node's self-advertised position alongside the
// name (#197) — but only for members: server-side it strips lat/lon below that
// role (httpapi/resolve.go), so a guest simply never gets a position here.
const cache = new Map()

// positionOf extracts a usable position from a resolve response. Both
// coordinates must be present and numeric — a half-position is no position.
function positionOf(j) {
  if (!j || typeof j.lat !== 'number' || typeof j.lon !== 'number') return null
  return { lat: j.lat, lon: j.lon }
}
const FULL_PUBKEY = /^[0-9a-f]{64}$/i
// 2..32 bytes: discover 8-byte prefixes, advert pubkeys, AND CoreScope 2-byte
// relay path-prefixes (all resolve uniquely via CoreScope). 1-byte hashes (2 hex)
// stay excluded. Ambiguous results are handled by resolveName (cached as '').
const RESOLVABLE = /^[0-9a-f]{4,64}$/i

export function isFullPubkey(id) { return typeof id === 'string' && FULL_PUBKEY.test(id) }
export function isResolvableId(id) { return typeof id === 'string' && RESOLVABLE.test(id) }

// resolvableKey decides whether a reception's sender should be looked up.
// Fill-only: skip when a name is already present. Ported from app/src/names.js
// so both sides gate resolution the same way.
export function resolvableKey(rec) {
  if (!rec || rec.sender_label) return null
  return isResolvableId(rec.sender_id) ? rec.sender_id.toLowerCase() : null
}

// How a name is printed (the guess mark, a hash id, a name by reach) is
// namerules.js, one file on both surfaces (#663).
import { isHashIdKind, displayName } from './namerules.js'
export { isHashIdKind, GUESS_MARK, isGuessedName, nameParts, displayName } from './namerules.js'

// cachedName: resolved name ('' = resolved-but-unknown) or undefined if not yet
// looked up. Synchronous — use it while rendering.
export function cachedName(key) {
  const k = String(key).toLowerCase()
  return cache.has(k) ? cache.get(k).name : undefined
}

// cachedPosition: the node's self-advertised position ({lat, lon}), null when
// it resolved without one (or the viewer's role is below member), undefined
// when not yet looked up. Same synchronous contract as cachedName.
export function cachedPosition(key) {
  const k = String(key).toLowerCase()
  return cache.has(k) ? cache.get(k).pos : undefined
}

// Test-only seam: clears the resolved-name cache between specs.
export function _resetNameCache() { cache.clear() }

// resolveName fetches a name for a prefix/pubkey via the same-origin resolve
// proxy and caches the result (null = resolved-but-unknown/ambiguous). Network
// errors leave the id unresolved (uncached) so it retries on a later draw.
export async function resolveName(key) {
  const k = String(key).toLowerCase()
  if (cache.has(k)) return cache.get(k).name

  let name = null
  let pos = null
  try {
    const r = await fetch(`${API_BASE}/api/resolve?prefix=${encodeURIComponent(k)}`, { credentials: 'same-origin' })
    if (r.ok) {
      const j = await r.json()
      if (j && j.name && !j.ambiguous) { name = j.name; pos = positionOf(j) }
    }
    cache.set(k, { name, pos })
  } catch {
    // transient — leave uncached so it retries on a later draw
  }
  return name
}

// senderName is the name a point or a ticker line prints, the app's
// senderText (receptionlog.js) with the map's one difference: a row without a
// label takes the name the resolve proxy cached for its id. After that the
// rule is namerules.js: a name on a short prefix wears the guess mark (#452),
// the attribution by reach decides a relay's name first (#661, _attr), and a
// 1-byte hash is # and its id until it is placed on a named node. Without a
// name the id stands, as before.
export function senderName(pt) {
  if (!pt) return '—'
  let rec = pt
  if (!pt.sender_label && isResolvableId(pt.sender_id)) {
    const hit = cachedName(pt.sender_id)
    if (hit) rec = { ...pt, sender_label: hit }
  }
  if (isHashIdKind(pt.sender_kind) && pt.sender_id) return displayName(rec) || '#' + String(pt.sender_id)
  return displayName(rec) || pt.sender_id || '—'
}
