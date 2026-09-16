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
//   hex features      records + zoom resolution + attenuator offset + theme + selection
//   pillar collapse   records
//   pillar features   records + zoom + attenuator offset + theme + selection
//   flat points       records + backlog zoom + offset + theme + coverage hues + selection
//
// The selection joined three rows in #624, when selecting a star started to dim
// the dots, the cells and the pillars as well as the rays. selectionKey below
// signs it. The collapse does not read it: which record survives a merge is
// decided by the ride and the strength, and the dim is applied afterwards.
//
// Nothing here reads the clock any more. It used to: the point collections
// carried ageFade, a continuous function of NOW, so they had to be rebuilt
// every tick or the fade froze on screen — which is why only the collapse was
// cached and the collection built from it was not. #648 removed the fade, so
// both collections answer to their inputs alone and both are cached.
//
// Every input is in the key or the cache lies. The one that is easy to miss is
// the coverage hue map, which decides a dot's colour while the reach is on;
// hueKey below signs it.

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

// hueKey signs the coverage hue map, for the same reason and with the same
// shape: while the reach is on, a dot takes its repeater's hue (#603), so the
// flat point collection depends on that map as much as on the records. Size
// alone would miss one repeater swapped for another between draws — which a
// selection change does routinely — and that direction of error serves last
// tick's colours over this tick's data.
//
// Insertion order is whatever drawCoverage produced, so the same contents in a
// different order sign differently. That costs a rebuild, never a wrong hit,
// which is the side to fail on.
//
// The "|" between an id and its hue is not decoration: without it ("ab", 12)
// and ("ab1", 2) both fold as "ab12", which is the wrong direction to fail in.
// It only earns that if neither side can contain it, which holds here — ids are
// hex sender ids and hues are numbers. The suite pins the collision case.
export function hueKey(hues) {
  if (!hues || typeof hues.size !== 'number' || typeof hues.forEach !== 'function') return null
  if (hues.size === 0) return '0'
  let h = 0
  hues.forEach((hue, id) => {
    const s = String(id) + '|' + String(hue)
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  })
  return hues.size + ':' + h
}

// selectionKey signs the coverage selection (#624). Since a selection dims the
// dots, the cells and the pillars, it is an input to all three collections, and
// a key that left it out would serve last tick's undimmed map after a tap.
//
// Sorted and lower-cased, unlike hueKey's insertion order: a selection is a set
// the user builds by tapping, so the same repeaters picked in another order, or
// arriving in another case, are the same selection and must not cost a rebuild.
// The comma is safe as a separator because the ids are hex pubkeys.
// An empty or absent selection signs as '', the commonest state by far.
export function selectionKey(selected) {
  if (!selected || !selected.size) return ''
  return [...selected].map((id) => String(id).toLowerCase()).sort().join(',')
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
