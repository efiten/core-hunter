// Attribution by reach for the rows a name is printed on (#663): the ticker's
// lines and the points behind a popup. attribution.js holds the rule; this
// fetches the registry slice it needs and puts the outcome on each row as
// _attr, which is where namerules.js reads it.
//
// The slice is the box around the rows, not around the view. The ticker shows
// the latest receptions wherever they were heard, and a row outside the view
// with no candidates fetched reads as "none in reach": it would print a name
// where the app prints none. The node-position layer keeps its own slice of
// the view, since it draws the nodes in view.
import { registryIndex, attributeReception, attributableId } from './attribution.js'

const isCoord = (v) => typeof v === 'number' && Number.isFinite(v)

// rowsBounds: the box around the rows that carry a position, or null. The
// caller's fetch pads it by the reach (fetchNodeRegistry, padBounds).
export function rowsBounds(rows) {
  let b = null
  for (const r of rows || []) {
    if (!r || !isCoord(r.lat) || !isCoord(r.lon)) continue
    if (!b) b = { south: r.lat, west: r.lon, north: r.lat, east: r.lon }
    else {
      b.south = Math.min(b.south, r.lat); b.north = Math.max(b.north, r.lat)
      b.west = Math.min(b.west, r.lon); b.east = Math.max(b.east, r.lon)
    }
  }
  return b
}

const covers = (outer, inner) => outer.south <= inner.south && outer.north >= inner.north
  && outer.west <= inner.west && outer.east >= inner.east
const union = (a, b) => ({ south: Math.min(a.south, b.south), west: Math.min(a.west, b.west), north: Math.max(a.north, b.north), east: Math.max(a.east, b.east) })

// A slice is reused while it covers the rows and is under a minute old: the
// ticker asks every 5 s while live, and the server's own registry cache is
// older than that anyway.
export const SLICE_TTL_MS = 60000
// After an answer that is not a whole registry, the rows read without one
// for this long rather than asking again on every poll of an outage.
export const RETRY_MS = 15000

// createRowAttributor({ fetchRegistry, allowed, now }).
// fetchRegistry(bounds) answers { status, nodes, truncated } (map.js's
// fetchNodeRegistry). allowed() says whether this account may read the
// registry: below member the server refuses, so nothing is asked and every
// row reads by rule 2, the resolver's name with its guess mark.
//
// An answer that is not a whole registry counts as none. Refused or failed has
// no nodes. Truncated has some, and a missing node is a missed candidate: a
// collision would read as a placement. Neither is kept, and the next ask is
// RETRY_MS later.
//
// A fresh slice that does not cover the rows grows to the box around both:
// the ticker's "all" stand attributes two pages a poll, and a slice of the
// last box alone would be fetched twice a poll where neither covers the other.
export function createRowAttributor({ fetchRegistry, allowed = () => true, now = () => Date.now() } = {}) {
  let slice = null   // { bounds, at, index }
  let failedAt = null
  async function indexFor(rows) {
    if (!allowed()) return null
    const bounds = rowsBounds(rows.filter((r) => attributableId(r) != null))
    if (!bounds) return null
    const fresh = slice && now() - slice.at < SLICE_TTL_MS
    if (fresh && covers(slice.bounds, bounds)) return slice.index
    if (failedAt != null && now() - failedAt < RETRY_MS) return null
    const want = fresh ? union(slice.bounds, bounds) : bounds
    const answer = await fetchRegistry(want)
    if (!answer || answer.status !== 'ok' || answer.truncated) { failedAt = now(); return null }
    failedAt = null
    slice = { bounds: want, at: now(), index: registryIndex(answer.nodes) }
    return slice.index
  }
  return {
    async attribute(rows) {
      const index = await indexFor(rows || [])
      for (const r of rows || []) r._attr = attributeReception(r, { index })
      return rows
    },
    reset() { slice = null; failedAt = null },
  }
}
