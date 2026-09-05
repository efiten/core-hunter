// On-the-fly node-name resolution: per heard prefix/pubkey, requests are sent
// to each configured CoreScope resolver in order. Resolvers are configured in
// config.json as a `resolvers` array (each { label?, sf?, url }). A bare
// `resolveUrl` is supported for back-compat (synthesized to a one-element
// resolvers array by normalizeConfig). Cached in memory for the session, so
// each distinct node is fetched at most once. A name is returned only when
// every registry of the companion's SF that knows the prefix agrees on it
// (#452); ambiguous, not-found or disagreeing → '' (caller shows the prefix).
import { getConfig } from './config.js';

// key (lowercase hex) -> { name: string|'', pos: {lat, lon} | null }.
// The resolver returns the node's self-advertised position alongside the name
// on a unique hit (#197); both are cached together so a resolved key is fetched
// at most once regardless of which of the two the caller wants.
const cache = new Map();

// positionOf extracts a usable position from a resolver response. Both
// coordinates must be present and numeric — a half-position is no position.
function positionOf(j) {
  if (!j || typeof j.lat !== 'number' || typeof j.lon !== 'number') return null;
  return { lat: j.lat, lon: j.lon };
}

// Lookups still in flight, so concurrent callers for the same key share one
// request instead of racing to the network. Entries live only until the
// lookup settles; the cache above is what persists the answer.
const inflight = new Map(); // key (lowercase hex) -> Promise<name | ''>

// A full MeshCore public key is 32 bytes = 64 lowercase-hex chars.
const FULL_PUBKEY = /^[0-9a-f]{64}$/i;
export function isFullPubkey(id) { return typeof id === 'string' && FULL_PUBKEY.test(id); }

// Resolvable = 2..32 bytes (4..64 hex): full advert pubkeys, discover 8-byte
// prefixes, AND CoreScope 2-byte relay path-prefixes — CoreScope resolves all of
// these, returning `ambiguous` when a prefix collides (handled by resolveName,
// cached as ''). 1-byte hashes (2 hex) stay excluded: too collision-prone to
// name. Mirrors the analysis website's gate (web/names.js) so a relayed advert
// heard by the hunter shows the same repeater name the map does.
const RESOLVABLE = /^[0-9a-f]{4,64}$/i;
export function isResolvableId(id) { return typeof id === 'string' && RESOLVABLE.test(id); }

// resolvableKey decides whether a reception's sender should be looked up.
// Fill-only: skip when a name is already present (advert appData.name, channel
// sender). Resolve any resolvable id (full pubkey or >= 2-byte prefix); the
// resolver's ambiguous flag guards against wrong names. Returns the lowercase
// key to resolve, or null.
export function resolvableKey(rec) {
  if (!rec || rec.sender_label) return null;
  return isResolvableId(rec.sender_id) ? rec.sender_id.toLowerCase() : null;
}

// A sender id of one byte (2 hex) is a 256-way collision space, so it is never
// a name, and meshpacket.js carries it as its OWN sender_label for the two
// kinds below. A surface that prints that label unguarded shows "77" exactly
// as it would show a resolved short name. Marked with # instead, the house
// style hudsender.js set, and kept out of the resolver by the 4-hex floor.
const HASH_ID_KINDS = ['direct_hash', 'path_hash']
export function isHashIdKind(kind) { return HASH_ID_KINDS.includes(kind) }

// cachedName returns a previously-resolved name ('' = resolved-but-unknown) for
// a key, or undefined when it has not been resolved yet. Synchronous — safe to
// call from a render loop; pair with a fire-and-forget resolveName() for misses.
export function cachedName(key) {
  const k = String(key).toLowerCase();
  return cache.has(k) ? cache.get(k).name : undefined;
}

// cachedPosition returns the node's self-advertised position for a key:
// {lat, lon} when the registry had one, null when it resolved without a
// position, undefined when the key has not been resolved yet. Same
// synchronous, render-loop-safe contract as cachedName.
export function cachedPosition(key) {
  const k = String(key).toLowerCase();
  return cache.has(k) ? cache.get(k).pos : undefined;
}

// resolversFor picks the registries to ask (#452): every resolver of the
// companion's spreading factor, in config order. A registry of another SF
// names nodes this radio cannot hear, so it is left out; with the SF unknown
// (firmware-gated) or matching none, all of them are asked.
export function resolversFor(resolvers, companionSf) {
  const matching = companionSf == null ? [] : resolvers.filter(r => r.sf === companionSf);
  return matching.length ? matching : resolvers.slice();
}

// consensusName reduces the names the registries answered to one or none.
// A registry's ambiguous=false is a claim about that registry only: a second
// one may know the same prefix under another name. Unanimity is a name,
// silence is no name, and disagreement is a refusal, which is evidence
// against, exactly as mergePrefixGroups treats it (feed.js).
export function consensusName(names) {
  const distinct = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (distinct.length === 1) return { name: distinct[0], refused: false };
  return { name: '', refused: distinct.length > 1 };
}

// A name resolved for a short prefix is a guess about who was heard: a 2- or
// 3-byte id is one in 65,536 or 16 million per registry, and a relay hash is
// the forwarder's, not a node id. The name stays (it is usually right, and
// the field reads by it) and wears GUESS_MARK on every surface, so nothing
// presents it as a resolved identity (#452). An advert's own name on its
// full key, a channel sender's name and an 8-byte discover prefix are not
// guesses; a 1-byte hash never carries a name at all (isHashIdKind).
export const GUESS_MARK = '~';
const GUESS_MAX_HEX = 6;
export function isGuessedName(rec) {
  if (!rec || !rec.sender_label) return false;
  if (rec.sender_kind === 'channel_name' || isHashIdKind(rec.sender_kind)) return false;
  const id = typeof rec.sender_id === 'string' ? rec.sender_id : '';
  return /^[0-9a-f]+$/i.test(id) && id.length <= GUESS_MAX_HEX;
}
// displayName: the label as a surface should print it, marked when guessed;
// '' when there is no label, so callers fall back to the id as before.
export function displayName(rec) {
  if (!rec || !rec.sender_label) return '';
  return (isGuessedName(rec) ? GUESS_MARK : '') + String(rec.sender_label);
}

// resolveName resolves a heard key (2-3 byte prefix, 8-byte prefix or full
// pubkey) to a name. Every resolver of the companion's SF is asked at once
// (resolversFor) and the answers go through consensusName: a name only when
// the registries that know the prefix agree on it (#452).
// Returns '' when unconfigured, ambiguous, unknown or refused.
// Network/transport errors are NOT cached (retry later); '' is only cached
// when every resolver responded, or when two of them disagreed, which no
// retry can turn into a name.
export async function resolveName(key, companionSf /* = undefined */) {
  const c = getConfig();
  const resolvers = c && c.resolvers && c.resolvers.length > 0 ? c.resolvers : [];
  if (resolvers.length === 0) return '';

  const k = key.toLowerCase();
  if (cache.has(k)) return cache.get(k).name;
  // The cache is only written once a lookup RESOLVES, so it cannot deduplicate
  // callers that arrive while one is still in flight — and drawOnce enriches
  // two overlapping row sets per 1 Hz tick, so every unresolved id was being
  // fetched twice a second. Coalesce on the promise instead (#230). Cleared in
  // `finally` so a failed lookup is retried on a later tick rather than wedged.
  if (inflight.has(k)) return inflight.get(k);

  const asked = resolversFor(resolvers, companionSf);

  const lookup = (async () => {
    let anyNetworkError = false;
    const hits = [];
    await Promise.all(asked.map(async (resolver) => {
      try {
        const r = await fetch(resolver.url + '?prefix=' + encodeURIComponent(k));
        // An HTTP error from this resolver is "no result" from it.
        if (!r.ok) return;
        const j = await r.json();
        if (j && !j.ambiguous && j.name) hits.push(j);
      } catch (e) {
        // Transient network error — mark so we don't cache '' at the end.
        anyNetworkError = true;
      }
    }));
    const { name, refused } = consensusName(hits.map(j => j.name));
    if (name) {
      // Name and position are cached together (#197): the first hit that
      // carries a position supplies it.
      const withPos = hits.find(j => positionOf(j));
      cache.set(k, { name, pos: withPos ? positionOf(withPos) : null });
      return name;
    }
    // Only cache '' when every resolver definitively had no unique name, or
    // when they disagreed: a refusal stands however often it is retried.
    if (refused || !anyNetworkError) cache.set(k, { name: '', pos: null });
    return '';
  })();

  inflight.set(k, lookup);
  try {
    return await lookup;
  } finally {
    inflight.delete(k);
  }
}
