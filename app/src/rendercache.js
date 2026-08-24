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
// arrives leaves it identical — so the ids are folded in too. That is an O(n)
// pass, which is the point: an integer multiply-add per row costs about 1 ms
// where the work it guards costs 157 ms.
export function recordsKey(records) {
  if (!Array.isArray(records) || records.length === 0) return '0'
  let h = 0
  for (const r of records) h = (h * 31 + ((r && r.id) | 0)) | 0
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
      if (!has || k !== key) { key = k; value = build(); has = true }
      return value
    },
    // For tests and for a caller that wants to force a rebuild.
    clear() { has = false; key = undefined; value = undefined },
  }
}
