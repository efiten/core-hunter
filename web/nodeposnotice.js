// What the node-position layer must have on screen, and what it says when it
// has nothing to draw (#376).
//
// PORTED from app/src/nodeposnotice.js, and deliberately a superset: the two
// constants and nodePosKeyText() are kept identical (pinned by
// parity.test.js), while nodePosPresentation() covers the states only the
// website has. The app fetches one registry it configures itself and shows the
// layer to whoever is running it; the website asks a server-side proxy that can
// be unconfigured, unreachable, or refuse the caller's role, and each of those
// ends in the same empty layer.
//
// The rationale is #307's, unchanged:
//
//   Toggling the layer on used to look identical whether it had worked with
//   nothing to show or failed silently — and a glyph key is worse than useless
//   with no glyphs on screen, since it implies the layer is fine and the area
//   is simply empty.
//
// Web's note does not fade on a wide screen (the app's always does): it sits in
// the corner rather than over the HUD, so #306 does not apply there.
//
// On a narrow one it does (#426). The corner is cheap on a desktop map and
// expensive on a phone: the same 300px block is roughly a quarter of the
// viewport, over the part of the map a hunter is looking at. So the argument
// that #306 does not apply is a statement about screen size, not about web, and
// this is where that gets said out loud.
//
// The key never fades either way. It is one line, and it is the half AGENTS.md
// §7 actually requires.
export const NODEPOS_GLANCE_MS = 2000

export const NODEPOS_KEY_TEXT = '▲ advertised position (operator-reported) · ● estimate inferred from RSSI'

// The registry answered and holds no position at all. Names the registry,
// because that is the half that is missing; "no nodes in view right now" is a
// different sentence — and on this side it is a separate state below.
export const NODEPOS_EMPTY_TEXT = 'No positions from the node registry — resolver unreachable or it holds none, so nothing can be drawn'

// Below member the server strips positions, so the layer cannot draw whatever
// the map is showing. Same remedy web/auth.js's guestNotice() names, since a
// second wording for one account state would read as a second problem.
export const NODEPOS_GUEST_TEXT = 'Node positions need a verified member account — everything else on the map stays visible'

// The deployment has no registry configured (server 503 registry_not_configured).
// Operator-facing, and deliberately not merged into "unreachable": one is a
// missing config key, the other is a service that is down, and telling them
// apart is the difference between waiting and fixing something.
export const NODEPOS_UNCONFIGURED_TEXT = 'This server has no node registry configured, so no advertised positions can be shown'

// The proxy could not reach its registry. Distinct from the empty case: there
// may well be positions, we just do not have them.
export const NODEPOS_UNAVAILABLE_TEXT = 'Node registry unreachable — advertised positions cannot be fetched right now'

// The registry answered for this viewport and had nothing in it. The one state
// where the layer is genuinely working and the area is genuinely empty, which
// is exactly the claim the other messages must not make.
export const NODEPOS_NONE_IN_VIEW_TEXT = 'No registry nodes in this view — pan or zoom out to find some'

// Appended when the proxy served a cached registry it could not refresh. The
// positions are real, their age is not guaranteed, and a node that moved (or
// appeared) in the last few minutes may be drawn wrong or not at all.
export const NODEPOS_STALE_SUFFIX = ' · registry not refreshed, positions may be a few minutes old'

// Kept for parity with the app copy: the same two lines, chosen the same way.
export function nodePosKeyText({ registryEmpty = false } = {}) {
  return registryEmpty ? NODEPOS_EMPTY_TEXT : NODEPOS_KEY_TEXT
}

// What the two surfaces say for one draw.
//
//   key  — one line, on screen for exactly as long as the layer is. Names the
//          glyphs when there are glyphs, and otherwise says which of the ways
//          to draw nothing this was. AGENTS.md §7 requires the first; #376 is
//          about the rest.
//   note — the disclaimer prose. Only with markers on screen: it asserts that
//          advertised positions are being shown, which is false in every other
//          state, and a disclaimer for absent data reads as "the layer works,
//          the area is empty" — the exact confusion this replaces.
//
// `registry` is fetchNodeRegistry()'s answer: null when the fetch itself
// failed, otherwise {status, stale}. `drawn` is how many markers this draw
// actually produced — not how many rows arrived, since a row can survive the
// registry and still be unplottable.
export function nodePosPresentation({ on = false, member = true, registry = null, drawn = 0, narrow = false, glanceExpired = false } = {}) {
  if (!on) return { note: false, key: '' }
  if (!member) return { note: false, key: NODEPOS_GUEST_TEXT }

  const status = registry ? registry.status : 'unavailable'
  const stale = Boolean(registry && registry.stale)
  if (status === 'forbidden') return { note: false, key: NODEPOS_GUEST_TEXT }
  if (status === 'not_configured') return { note: false, key: NODEPOS_UNCONFIGURED_TEXT }
  if (status === 'empty') return { note: false, key: nodePosKeyText({ registryEmpty: true }) }
  if (status !== 'ok') return { note: false, key: NODEPOS_UNAVAILABLE_TEXT }

  const suffix = stale ? NODEPOS_STALE_SUFFIX : ''
  if (drawn <= 0) return { note: false, key: NODEPOS_NONE_IN_VIEW_TEXT + suffix }
  // The only branch that shows the prose at all, so the glance only has to be
  // asked here. Both terms are required: a wide screen keeps it however long
  // the layer is on, and a narrow one keeps it until the glance is over.
  return { note: !(narrow && glanceExpired), key: nodePosKeyText({ registryEmpty: false }) + suffix }
}

// Maps one /api/nodes/positions response onto the status above. The server
// answers 403 below member and three distinct 503s (nodes.go), and collapsing
// them here would undo the reason they are distinct there.
export function registryStatusFor(httpStatus, errorCode) {
  if (httpStatus === 200) return 'ok'
  if (httpStatus === 403) return 'forbidden'
  if (errorCode === 'registry_not_configured') return 'not_configured'
  if (errorCode === 'registry_empty') return 'empty'
  return 'unavailable'
}
