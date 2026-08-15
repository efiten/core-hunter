// deferWhile(isBlocked) holds redraws back while something on screen would be
// destroyed by them, and runs them once that thing is gone.
//
// The case it exists for: a name resolves asynchronously and the map redraws to
// show it, but every redraw path starts by clearing its layer — and removing a
// marker closes its popup. A user who clicks a point right as it appears can
// watch the popup vanish under the cursor because a background lookup finished
// (#271). Only automatic redraws need holding; a redraw the user asked for
// (filter change, pan, layer toggle) closing a popup is expected.
//
// One held redraw PER KIND, not one in total. The point layer and each CS
// observer layer redraw independently, and the observer layers are redrawn
// only by explicit triggers — never by a pan or a filter change — so a
// coalesced-away observer redraw would leave raw hex ids on screen for the
// rest of the session. Within a kind the latest wins: several senders can
// resolve while one popup is open, and only the last redraw matters.
//
// flush() re-checks isBlocked and keeps holding if it is still true. Leaflet
// removes the previous popup before adding the next one, so popupclose fires
// while the next popup is already opening; flushing there would clear the
// layer out from under the arriving popup, which is this module's own bug one
// interaction later.
export function deferWhile(isBlocked) {
  const held = new Map()
  return {
    // run(kind, fn) → true if it ran now, false if it was held for later.
    run(kind, fn) {
      if (isBlocked()) { held.set(kind, fn); return false }
      fn()
      return true
    },
    // flush() → true if anything ran. Safe to call whenever the blocker may
    // have cleared; it decides for itself whether it actually has.
    flush() {
      if (isBlocked() || held.size === 0) return false
      const fns = [...held.values()]
      held.clear()
      for (const fn of fns) fn()
      return true
    },
  }
}
