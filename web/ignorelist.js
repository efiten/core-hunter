// The map's ignore-list (#494): senders whose receptions are dropped before
// they reach any layer. Ported from the app (app/src/app.js loadIgnore/
// saveIgnore, app/src/filters.js), with two deliberate differences.
//
// It filters SERVER-side. The app filters rows it already holds, so an ignore
// there is a display filter over local data. The map asks the server for
// everything it draws, so the list travels as ?ignore= and the rows never
// leave the database. That also makes it work in the hex layer, which has no
// per-row client path at all.
//
// It stays out of the URL. Every other filter is in there, but a shared link
// that silently hides nodes for whoever opens it is a different thing from a
// shared view. Ignoring is per person, like the theme.

export const IGNORE_KEY = 'core-hunter-ignore'

// loadIgnore reads the persisted list. Storage can be missing (private mode),
// unreadable, or hold something that is not an id list; none of that is worth
// an error on a filter, so all of it means "nothing ignored".
export function loadIgnore(storage) {
  try {
    const raw = storage && storage.getItem(IGNORE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.toLowerCase()))
  } catch (_) {
    return new Set()
  }
}

// saveIgnore persists the list, reporting whether it stuck. A full or blocked
// quota is the one case worth telling the caller about: the UI has already
// drawn the change, and silently forgetting it on reload is worse than saying
// so.
export function saveIgnore(storage, set) {
  try {
    storage.setItem(IGNORE_KEY, JSON.stringify([...set]))
    return true
  } catch (_) {
    return false
  }
}

// toggleIgnore adds or removes a whole node. ids is the row's id group, since
// one physical node is known by up to three prefixes (#331) and ignoring one
// of them would leave the other two on the map. Mirrors multiselect.js's
// toggle: if any variant is listed the node counts as ignored, so the toggle
// clears all of them.
export function toggleIgnore(set, ids) {
  const keys = (Array.isArray(ids) ? ids : [ids])
    .filter((i) => i != null && String(i).trim())
    .map((i) => String(i).toLowerCase())
  const next = new Set(set || [])
  if (keys.some((k) => next.has(k))) {
    for (const k of keys) next.delete(k)
  } else {
    for (const k of keys) next.add(k)
  }
  return next
}

// isIgnored reports whether any variant of a node is on the list.
export function isIgnored(set, ids) {
  if (!set || set.size === 0) return false
  const keys = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((i) => String(i).toLowerCase())
  return keys.some((k) => set.has(k))
}

// ignoreParams renders the list as query params. One id per repeated ?ignores=,
// never a delimiter-joined value: sender_id is the decrypted display name for
// channel senders, i.e. arbitrary operator text, so a comma in a name would
// split it into fragments that match other nodes or nothing at all. This is
// the same reasoning, and the same shape, as ?senders= in #288.
//
// ?ignores= rather than ?ignore=: the comma-separated ?ignore= is the operator
// config's param and stays what it is (server/internal/httpapi/api.go).
export function ignoreParams(set) {
  return [...(set || [])].filter(Boolean).map((id) => ['ignores', String(id)])
}
