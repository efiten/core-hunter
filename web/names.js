// Client-side node-name resolution for the analysis map. Each distinct pubkey /
// pubkey-prefix is fetched from the same-origin resolve proxy at most once and
// cached. Resolvable = a full 32-byte pubkey (advert) OR a >= 4-byte prefix
// (discover reply) — the resolver resolves those uniquely. 1-byte source/path
// hashes (2 hex) are ambiguous and skipped.
import { API_BASE } from './config.js'

const cache = new Map() // key (lowercase hex) -> name | ''
const FULL_PUBKEY = /^[0-9a-f]{64}$/i
// 2..32 bytes: discover 8-byte prefixes, advert pubkeys, AND CoreScope 2-byte
// relay path-prefixes (all resolve uniquely via CoreScope). 1-byte hashes (2 hex)
// stay excluded. Ambiguous results are handled by resolveName (cached as '').
const RESOLVABLE = /^[0-9a-f]{4,64}$/i

export function isFullPubkey(id) { return typeof id === 'string' && FULL_PUBKEY.test(id) }
export function isResolvableId(id) { return typeof id === 'string' && RESOLVABLE.test(id) }

// cachedName: resolved name ('' = resolved-but-unknown) or undefined if not yet
// looked up. Synchronous — use it while rendering.
export function cachedName(key) {
  const k = String(key).toLowerCase()
  return cache.has(k) ? cache.get(k) : undefined
}

// Test-only seam: clears the resolved-name cache between specs.
export function _resetNameCache() { cache.clear() }

// resolveName fetches a name for a prefix/pubkey via the same-origin resolve
// proxy and caches the result (null = resolved-but-unknown/ambiguous). Network
// errors leave the id unresolved (uncached) so it retries on a later draw.
export async function resolveName(key) {
  const k = String(key).toLowerCase()
  if (cache.has(k)) return cache.get(k)

  let name = null
  try {
    const r = await fetch(`${API_BASE}/api/resolve?prefix=${encodeURIComponent(k)}`, { credentials: 'same-origin' })
    if (r.ok) {
      const j = await r.json()
      if (j && j.name && !j.ambiguous) name = j.name
    }
    cache.set(k, name)
  } catch {
    // transient — leave uncached so it retries on a later draw
  }
  return name
}

// senderName picks the best label for a point: an existing server label wins
// (fill-only — advert broadcast names), then a cached resolved name for a
// resolvable id (full pubkey or discover prefix), then the raw id.
export function senderName(pt) {
  if (pt.sender_label) return pt.sender_label
  if (isResolvableId(pt.sender_id)) {
    const hit = cachedName(pt.sender_id)
    if (hit) return hit
  }
  return pt.sender_id || '—'
}
