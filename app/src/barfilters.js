// The filter panel (#423 built it for phones; #539 made it the only
// presentation).
//
// Fourteen type chips, the id-class chips, two checkboxes, the layer
// controls and Clear used to lay out inline in #bar above 640px — a full
// bar row that read as one long strip without groups. The bar now keeps
// five controls (hunters, sender, time, the Filters pill, the right-side
// meta) and everything else lives in this panel at every width, in named
// groups. The pill carries the count ("Filters (3)") the way the hunter
// picker does, so the bar shows THAT and HOW MUCH is narrowed; the panel
// shows what.
//
// The controls are still NOT re-parented at open time (#372, #385): the
// container is simply the panel now, shown and hidden as one element, so
// nothing measures differently between states.

// How many filter dimensions are narrowed (#539). Dimensions, not chips:
// four active type chips are one narrowed dimension, and clearing it is one
// act — the pill says "Filters (N)" and the clear button "Clear N filters",
// and both must promise the same thing. The layer mode is deliberately NOT
// counted: it is a view choice, and Clear has never reset it.
//
// This list is the panel's inventory, and it does not maintain itself: a
// control added to the panel later stays dark here until it is added below.
// #497 landed "Sender unknown" while a branch was open and the old boolean
// version missed it — filtered map, pill said nothing.
//
// Copied into app/src/barfilters.js verbatim since #564, when the app's panel
// gained the same count; web/parity.test.js pins the two files byte-identical,
// so a dimension added on one surface and not the other fails the suite.
// The union of both surfaces' dimensions since #564, so one function answers
// for both panels. Each surface passes what it has and the rest default off:
// `window` is the app's "Plot last" (the map's timeframe is a bar control and
// travels in the URL, so Clear has never reset it either); the three overlay
// flags are the map's alone.
export function activeFilterCount({ directOnly = false, senderUnknown = false, types = null, idClasses = null, window = false, csAdverts = false, csRelays = false, nodePos = false } = {}) {
  let n = 0
  if (directOnly) n++
  if (senderUnknown) n++
  // An empty/absent set means "no type filter" -- same convention as the app's
  // isFilterActive, where `types` present and non-empty is the active state.
  if (types && [...types].length > 0) n++
  // Same convention for the sender-id class dimension (#475).
  if (idClasses && [...idClasses].length > 0) n++
  if (window) n++
  if (csAdverts) n++
  if (csRelays) n++
  if (nodePos) n++
  return n
}
