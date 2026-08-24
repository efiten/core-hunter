// Skipping per-tick work whose answer cannot have changed (#462).
//
// draw() runs at 1 Hz and rebuilds every FeatureCollection from scratch. With a
// parked hunter and no time filter that is the same tens of thousands of rows
// re-binned and re-collapsed sixty times a minute for an identical result:
// measured at 1.7 s per tick on a 6x-throttled CPU, which is longer than the
// interval itself, so the app fell to roughly 0.5 Hz with the CPU pinned.
//
// What may be cached is decided by what each derivation actually reads:
//
//   hex features      records + zoom resolution + attenuator offset
//   pillar collapse   records
//   flat points       records + NOW  <- age-fade, so never cached
//
// ageFade() is a continuous function of the clock, so anything carrying it has
// to be rebuilt every tick or the fade freezes. That is why this caches the
// collapse rather than the 3D collection built from it: the expensive half does
// not depend on the time, and the half that does is cheap.

// recordsKey is a content signature, not an identity check: drawOnce() hands
// render() a freshly filtered array every tick, so the reference always differs
// even when nothing changed.
//
// Length alone is not enough — one row ageing out of the window as another
// arrives leaves it identical — so every id is folded in. Nor is length plus
// the id range: a row swapped for another inside that range keeps all three,
// and a filter change can do exactly that, which would hand back the previous
// tick's answer for a set that is no longer the same one (the trap #474 found
// itself in). Folding is an O(n) integer pass, which is the point: about 1 ms
// to guard 157 ms.
//
// null means "cannot be signed", not "empty": a record with no numeric id
// carries nothing to fold, so two different sets of them would sign alike. The
// honest answer there is to recompute rather than trust a signature that does
// not describe the data — lastValueCache never reuses a null key. (Records come
// from the IndexedDB store, so they always have one; this is the guard for the
// day something else calls render(). Borrowed from #474, which got this right.)
// An EMPTY set is signable and common, and keeps its own key.
export function recordsKey(records) {
  if (!Array.isArray(records)) return null
  if (records.length === 0) return '0'
  let h = 0
  for (const r of records) {
    const id = r == null ? undefined : r.id
    // typeof, not Number(): Number(null) is 0, which is finite, so a null id
    // would sign as a real record numbered zero. That is the same hole in both
    // shapes of this guard, and it is the one an unsigned set actually arrives
    // through — an absent field, not a string.
    if (typeof id !== 'number' || !Number.isFinite(id)) return null
    h = (h * 31 + (id | 0)) | 0
  }
  return records.length + ':' + h
}

// lastValueCache remembers exactly one result. Not an LRU: the caller asks the
// same question repeatedly and the answer changes when new receptions land, so
// a second slot would only ever hold the previous second's map.
export function lastValueCache() {
  let key
  let value
  let has = false
  return {
    get(k, build) {
      // A null key is "unsignable", never "a key that happens to be null":
      // build every time and store nothing, so a later signable set cannot
      // match against it either.
      if (k === null || k === undefined) { has = false; key = undefined; value = undefined; return build() }
      if (!has || k !== key) { key = k; value = build(); has = true }
      return value
    },
    // For tests and for a caller that wants to force a rebuild.
    clear() { has = false; key = undefined; value = undefined },
  }
}
