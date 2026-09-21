// The receptions of the whole time window, for what must not depend on the
// view (#664). A node's RSSI estimate, and the hub a star hangs from, are made
// of every hearing of that node; fetched with the viewport's bbox they were
// made of the hearings on screen, and moved with every pan, zoom and rotate.
//
// Without a bbox the query no longer changes with the view, so a pan asks for
// the very rows the draw before it fetched. The key says when that is so, and
// the cache hands the later draw the earlier fetch.

// windowKey names the rows a draw wants: the filters, and the range as the
// fields hold it. Not the resolved range: currentFilters() resolves `now-12h`
// against the clock on every call, so two draws a second apart would never
// agree on it, while they are after the same rows.
export function windowKey(filters, rawRange) {
  const rest = Object.entries(filters || {}).filter(([k]) => k !== 'from' && k !== 'to')
  return JSON.stringify([rest, (rawRange && rawRange.from) || '', (rawRange && rawRange.to) || ''])
}

// maxAgeMs sits a little under the live tick (a relative range refreshes
// every 10 s), so the tick always fetches fresh rows and the pans in between
// reuse them: an entry as old as the tick would be reused by the tick itself,
// since it is stamped when its fetch starts, not when the tick fired. Keyed,
// because one draw can want two sets: the filtered rows for the estimates,
// and the rows without the sender filter for the stars of the repeaters that
// are not selected. Entries past their age go on the next get, so the map
// holds what one filter state asks for and no more; an entry whose fetch is
// still out never goes, so a slow fetch is joined, not doubled. A failed fetch
// is not kept.
export function createWindowCache({ maxAgeMs, now = Date.now }) {
  const entries = new Map()
  return {
    get(key, load) {
      const t = now()
      for (const [k, e] of entries) if (e.settled && t - e.at >= maxAgeMs) entries.delete(k)
      const hit = entries.get(key)
      if (hit) return hit.promise
      const mine = { at: t, settled: false, promise: load() }
      entries.set(key, mine)
      // A fetch still out is always the entry under its key (nothing replaces
      // one that has not settled), so a failure removes exactly its own.
      mine.promise.then(() => { mine.settled = true }, () => entries.delete(key))
      return mine.promise
    },
  }
}
