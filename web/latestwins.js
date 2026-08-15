// latestWins() guards a draw that has to await a fetch before it can replace
// what is on screen.
//
// Each start() takes a ticket and returns a predicate that is true only while
// that ticket is still the newest one. A pan/zoom burst fires several
// overlapping draws whose responses can land in any order — without this, the
// slowest response wins and paints the map with the wrong bbox's data.
//
// Deliberately not an AbortController: this only decides who may paint, so an
// in-flight request that is still the newest when it lands is kept rather than
// cancelled and refetched.
export function latestWins() {
  let issued = 0
  return function start() {
    const mine = ++issued
    return () => mine === issued
  }
}
