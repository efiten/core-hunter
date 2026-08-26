// The mobile filter sheet (#423).
//
// web/style.css had no @media rule at all, so #bar -- position:fixed with
// flex-wrap:wrap -- wrapped its controls into six rows on a phone and took
// roughly 45% of the viewport. setMapTop() faithfully pushed #map down by that
// height, so the map got the bottom half of the screen and the ticker and the
// position disclaimer overlaid part of what was left.
//
// Parity with the app, which is phone-first and already solved this: one
// "Filters" pill in the bar (app/index.html #filter-pill) carrying an active
// state, opening a sheet with the secondary controls in it. The app marks the
// pill with a class rather than a count, so this does too -- a number would be
// a second thing to keep true, and "something is filtered" is the question a
// glance is asking.
//
// The controls are NOT re-parented into the sheet. #423 warns why: the bar's
// pickers are positioned by placePopover against their toggle's box (#372,
// #385), and moving a toggle lands its panel off-screen. Instead the group is
// one container that is `display: contents` above the breakpoint -- so the bar
// lays out exactly as it did -- and a fixed sheet below it. Nothing moves in
// the DOM, so nothing measures differently.

// Which of the sheet's controls are away from their default. Pure, so the rule
// is testable without a DOM; the caller reads the checkboxes.
//
// Deliberately NOT the hunter, sender and time-range filters: those stay in the
// bar at every width, so they speak for themselves. The pill answers "is
// anything I cannot see switched on", which is only about what the sheet hides.
// DEFAULT_MODE is web's cold layer mode (map.js: 'hex'), not the app's. Getting
// this wrong lights the dot on a map nobody has touched, which is the one
// failure that makes the indicator worthless -- it then says "filtered" always,
// so it says nothing.
//
// This list is the sheet's inventory, and it does not maintain itself: a
// control added to #bar-filters later is hidden behind the pill from its first
// day, but stays dark here until it is added below. #497 landed "Sender
// unknown" in the bar while this branch was open, and the rebase put it in the
// sheet without lighting the dot -- filtered map, pill says nothing.
export const DEFAULT_MODE = 'hex'

export function hiddenFiltersActive({ directOnly = false, senderUnknown = false, types = null, idClasses = null, csAdverts = false, csRelays = false, nodePos = false, mode = DEFAULT_MODE } = {}) {
  if (directOnly || senderUnknown) return true
  // An empty/absent set means "no type filter" -- same convention as the app's
  // isFilterActive, where `types` present and non-empty is the active state.
  if (types && [...types].length > 0) return true
  // Same convention for the sender-id class row (#475).
  if (idClasses && [...idClasses].length > 0) return true
  if (csAdverts || csRelays || nodePos) return true
  return mode !== DEFAULT_MODE
}
