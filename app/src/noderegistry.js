// Where a resolver's positioned nodes come from, for the two registry shapes
// the hunt runs against (#418).
//
//   nameresolver  GET .../api/nodes/positions  -> {count, nodes:[{pubkey,name,lat,lon}]}
//   CoreScope     GET .../api/nodes?limit=N    -> {total, nodes:[{public_key,name,lat,lon,...}]}
//
// CoreScope has no /positions route, so until this landed the node-position
// layer silently covered SF7 only — the same tool, quietly showing less in half
// the area it is used in. The facts are the same on both sides; what differs is
// a field name and whether the answer is paged, so the fallback is a second URL
// and a key mapping rather than a second layer.
//
// Pure URL/shape logic: the fetching lives in app.js.
import { resolversFor } from './names.js'

// CoreScope caps a page at 2000 rows however large the ?limit= (measured
// 2026-08-19: limit=5000 still answered 2000). Asking for its ceiling keeps the
// common ~2,500-node registry at two requests.
export const REGISTRY_PAGE = 2000

// Backstop for an upstream that always answers a full page. A short layer beats
// a fetch loop that never ends; at REGISTRY_PAGE that is 40,000 nodes, far past
// any real registry.
export const MAX_REGISTRY_PAGES = 20

function base(resolverUrl) {
  try {
    return new URL(String(resolverUrl))
  } catch (_) {
    return null
  }
}

// positionsUrl is the bulk endpoint of our own nameresolver: the same path with
// /resolve swapped for /positions. Null when the URL does not end in /resolve,
// since then there is nothing to swap and nothing to guess.
export function positionsUrl(resolverUrl) {
  const u = base(resolverUrl)
  if (!u || !/\/resolve$/.test(u.pathname)) return null
  u.pathname = u.pathname.replace(/\/resolve$/, '/positions')
  return u.toString()
}

// nodesPageUrl is the CoreScope fallback: the collection the /resolve route
// hangs off, asked for one page. Any query the configured URL carried is kept —
// an upstream reached through a proxy may need it — with limit/offset ours.
export function nodesPageUrl(resolverUrl, offset = 0, limit = REGISTRY_PAGE) {
  const u = base(resolverUrl)
  if (!u || !/\/resolve$/.test(u.pathname)) return null
  u.pathname = u.pathname.replace(/\/resolve$/, '')
  u.searchParams.set('limit', String(limit))
  if (offset > 0) u.searchParams.set('offset', String(offset))
  return u.toString()
}

function coord(v) { return typeof v === 'number' && Number.isFinite(v) }

// normalizeNodes maps either shape onto {pubkey, name, lat, lon}, dropping rows
// that cannot be drawn. 0,0 is dropped with them: a registry row whose position
// is absent decodes to it, and it is a real coordinate in the Gulf of Guinea,
// so drawing it puts a node on the map that is not there. Same rule the server
// proxy applies (nodes.go) and the same trap AGENTS.md §9 records for gps.
export function normalizeNodes(json) {
  const rows = json && Array.isArray(json.nodes) ? json.nodes : []
  const out = []
  for (const n of rows) {
    if (!n) continue
    const pubkey = n.pubkey || n.public_key
    if (!pubkey || !coord(n.lat) || !coord(n.lon)) continue
    if (n.lat === 0 && n.lon === 0) continue
    out.push({ pubkey: String(pubkey), name: n.name || '', lat: n.lat, lon: n.lon })
  }
  return out
}

// morePages says whether a page that returned `count` rows can be followed by
// another. A short page ends the walk; CoreScope's `total` cannot end it,
// because it reports the rows in that page, not in the registry.
export function morePages(count, page, limit = REGISTRY_PAGE) {
  return count >= limit && page + 1 < MAX_REGISTRY_PAGES
}

// candidateNodes picks the registry nodes a relay id may be placed on (#661):
// those of the resolvers on the companion's SF, the same resolvers #452 asks
// for a name (resolversFor), or of every resolver when the SF is unknown or
// matches none. A node on another SF cannot be the relay this radio heard.
// `lists` holds one { resolver, nodes, answered } per configured resolver,
// nodes [] for one that answered nothing: an unreachable resolver of the SF is
// no reason to count the nodes of another SF instead. A node two registries
// both list comes back twice; registryIndex (attribution.js) counts one pubkey
// once.
export function candidateNodes(lists, companionSf) {
  const chosen = new Set(resolversFor(lists.map((l) => l.resolver), companionSf))
  return lists.filter((l) => chosen.has(l.resolver)).flatMap((l) => l.nodes)
}

// resolversToLoad picks the resolvers a registry load asks (#661): those in
// scope that have not answered yet. With the companion's SF the scope is the
// resolvers candidateNodes counts, so a connect asks again for the registry
// its attribution needs; without one it is every resolver, since the layer
// draws every SF. `lists` holds one { resolver, nodes, answered } per resolver
// asked before. Latching per resolver, not on the first answer from any: an
// SF-11 registry that answered is no reason to stop asking the SF-8 one.
// An answer with no nodes is an answer (#307), so it is not asked again.
export function resolversToLoad(resolvers, lists, companionSf) {
  const answered = new Set(lists.filter((l) => l.answered).map((l) => l.resolver))
  return resolversFor(resolvers, companionSf).filter((r) => !answered.has(r))
}

// mergeRegistryLists folds one load into the lists: a resolver it asked takes
// its new entry in place, and every resolver it did not ask keeps its own. A
// load asks only resolvers that have not answered (resolversToLoad), so a
// failure only ever replaces a failure, and a resolver that answered keeps its
// nodes through a retry of another.
export function mergeRegistryLists(prev, fresh) {
  const byResolver = new Map(fresh.map((l) => [l.resolver, l]))
  const out = prev.map((l) => byResolver.get(l.resolver) || l)
  const known = new Set(prev.map((l) => l.resolver))
  for (const l of fresh) if (!known.has(l.resolver)) out.push(l)
  return out
}

// registryLoadPlan splits a load into the resolvers to ask now and the ones
// already out (#661): each resolver is its own request, folded in when it
// settles, so a slow one holds back nothing but itself. `out` holds the
// resolvers with a request out. A resolver already out is waited for, never
// asked twice. The scope is resolversToLoad's, so a connect waits only for its
// own SF: an SF-11 resolver still out is no reason to hold back the SF-8 one.
// `lists` comes back with every resolver it asks listed as not answered, so
// while it is out its SF counts no nodes, instead of falling back to the nodes
// of a resolver on another SF that answered first (candidateNodes).
export function registryLoadPlan(resolvers, lists, out, companionSf) {
  const outNow = new Set(out)
  const missing = resolversToLoad(resolvers, lists, companionSf)
  const ask = missing.filter((r) => !outNow.has(r))
  const wait = missing.filter((r) => outNow.has(r))
  const asked = ask.map((resolver) => ({ resolver, nodes: [], answered: false }))
  return { ask, wait, lists: mergeRegistryLists(lists, asked) }
}
