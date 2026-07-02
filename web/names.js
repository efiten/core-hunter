// Client-side node-name resolution for the analysis map. Each distinct pubkey /
// pubkey-prefix is fetched from the configured resolvers (tried in order, first
// unambiguous hit wins) at most once and cached. Resolvable = a full 32-byte
// pubkey (advert) OR a >= 4-byte prefix (discover reply) — the resolvers
// resolve those uniquely. 1-byte source/path hashes (2 hex) are ambiguous and
// skipped.
import { RESOLVE_URLS } from './config.js'

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

// resolveName fetches a name for a full pubkey, trying each resolver url in
// order and caching the result. A unique hit from any resolver caches the name
// and stops the search; an HTTP error or ambiguous/not-found response falls
// through to the next resolver. Once all resolvers have been tried, '' is
// cached (so we stop asking) UNLESS one of them had a transport error, in
// which case '' is returned uncached so it retries on a later draw.
export async function resolveName(key, urls = RESOLVE_URLS) {
  if (!urls || urls.length === 0) return ''
  const k = String(key).toLowerCase()
  if (cache.has(k)) return cache.get(k)

  let anyNetworkError = false
  for (const url of urls) {
    try {
      const r = await fetch(url + '?prefix=' + encodeURIComponent(k))
      if (!r.ok) continue // HTTP error from this resolver — try the next
      const j = await r.json()
      const name = !j.ambiguous && j.name ? j.name : ''
      if (name) {
        cache.set(k, name)
        return name
      }
      // ambiguous or not found — try next resolver
    } catch {
      anyNetworkError = true // transient — keep going, don't cache '' at the end
    }
  }

  if (!anyNetworkError) cache.set(k, '')
  return ''
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
