// deferWhile(isBlocked) holds a redraw back while something on screen would be
// destroyed by it, and runs it once that thing is gone.
//
// The case it exists for: a name resolves asynchronously and the map redraws to
// show it, but every redraw path starts by clearing its layer — and removing a
// marker closes its popup. A user who clicks a point right as it appears can
// watch the popup vanish under the cursor because a background lookup finished
// (#271). Only automatic redraws need holding; a redraw the user asked for
// (filter change, pan, layer toggle) closing a popup is expected.
//
// Holds only the most recent redraw: several senders can resolve while one
// popup is open, and the map only needs the last one. The held callback
// re-checks its own preconditions when it finally runs, since anything can have
// changed while it waited.
export function deferWhile(isBlocked) {
  let held = null
  return {
    // run(fn) → true if it ran now, false if it was held for later.
    run(fn) {
      if (isBlocked()) { held = fn; return false }
      fn()
      return true
    },
    // flush() → true if a held redraw ran. Call it once unblocked.
    flush() {
      const fn = held
      held = null
      if (!fn) return false
      fn()
      return true
    },
  }
}
