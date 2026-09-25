// What the node-position layer writes over the map, and what it says when it
// has nothing to draw (#376).
//
// PORTED from app/src/nodeposnotice.js, and deliberately a superset: the shared
// constants and nodePosKeyText() are kept identical (pinned by
// parity.test.js), while nodePosPresentation() covers the states only the
// website has. The app fetches one registry it configures itself and shows the
// layer to whoever is running it; the website asks a server-side proxy that can
// be unconfigured, unreachable, or refuse the caller's role, and each of those
// ends in the same empty layer.
//
// The rationale is #307's, unchanged: toggling the layer on used to look
// identical whether it had worked with nothing to show or failed silently.
//
// Since #631 the glyph meaning lives in the marker popup's glyph line, and
// since #662 nothing over the map or in the popup repeats that positions are
// inferred: the onboarding and the About sheet say that once
// (docs/2026-09-15-position-notices.md). What is left here is one line that
// explains an absence or an old registry, and it does not fade, because the
// reason a map is blank has to stay for as long as the map is.
//
// The exception is an outage (#591): since #604 the layer still draws through
// one, every star from its estimate, so the map is not blank and the line
// that says why the ▲ are gone is a glance, 3 s once per outage (nextNotice).
// On a phone a line that never went was a notice over the map for the rest
// of the drive (Kasper, 2026-09-06).

// The registry answered and holds no position at all. Names the registry,
// because that is the half that is missing; "no nodes in view right now" is a
// different sentence — and on this side it is a separate state below.
export const NODEPOS_EMPTY_TEXT = 'No positions from the node registry — resolver unreachable or it holds none, so nothing can be drawn'

// The server answered 403 to a caller the page took for a member, so the layer
// cannot draw whatever the map is showing. A role the page already knows is
// below member gets its own reason instead (auth.js nodePosReason, #630). Same
// remedy web/auth.js's guestNotice() names, since a second wording for one
// account state would read as a second problem.
export const NODEPOS_GUEST_TEXT = 'Node positions need a verified member account — everything else on the map stays visible'

// The deployment has no registry configured (server 503 registry_not_configured).
// Operator-facing, and deliberately not merged into "unreachable": one is a
// missing config key, the other is a service that is down, and telling them
// apart is the difference between waiting and fixing something.
export const NODEPOS_UNCONFIGURED_TEXT = 'This server has no node registry configured, so no advertised positions can be shown'

// The proxy could not reach its registry. Distinct from the empty case: there
// may well be positions, we just do not have them.
export const NODEPOS_UNAVAILABLE_TEXT = 'Node registry unreachable — advertised positions cannot be fetched right now'

// The browser did not get an answer from the map server itself: the fetch
// failed, or a 5xx came back without an error code of ours, which is what a
// proxy in front of the server sends when it gives up (#591). A different
// thing to wait for than the registry being out, so a different line.
export const NODEPOS_SERVER_UNREACHABLE_TEXT = 'Map server unreachable: advertised positions cannot be fetched right now'

// How long an outage line stays up (#591).
export const NODEPOS_GLANCE_MS = 3000

// The registry answered for this viewport and had nothing in it. The one state
// where the layer is genuinely working and the area is genuinely empty, which
// is exactly the claim the other messages must not make.
export const NODEPOS_NONE_IN_VIEW_TEXT = 'No registry nodes in this view — pan or zoom out to find some'

// Shown when the proxy served a cached registry it could not refresh. The
// positions are real, their age is not guaranteed, and a node that moved (or
// appeared) in the last few minutes may be drawn wrong or not at all.
//
// A sentence, not a suffix. It used to carry its own ' · ' because it was only
// ever appended to the glyph key; with that key gone (#631) it is the whole
// line in the drawing state, and a line may not open with a separator. The
// separator belongs to the join below.
export const NODEPOS_STALE_TEXT = 'registry not refreshed, positions may be a few minutes old'

// Kept in step with the app copy: the explanation for an empty registry, or
// nothing at all. With markers on screen the popup answers what a glyph is,
// and the line that used to repeat it over the map is what #631 removed.
export function nodePosKeyText({ registryEmpty = false } = {}) {
  return registryEmpty ? NODEPOS_EMPTY_TEXT : ''
}

// What the line says for one draw: which of the ways to draw nothing this was,
// or that the registry could not be refreshed, and empty when there is
// something to draw and nothing to report (#376).
//
// `reason` is auth.js nodePosReason() for the viewer's role: null from member
// up, and below member the whole line, since the account is why the layer is
// empty whatever the registry says (#630).
//
// `registry` is fetchNodeRegistry()'s answer: null when the fetch itself
// failed, otherwise {status, stale}. `drawn` is how many markers this draw
// actually produced, not how many rows arrived, since a row can survive the
// registry and still be unplottable.
export function nodePosPresentation({ on = false, reason = null, registry = null, drawn = 0 } = {}) {
  if (!on) return { key: '' }
  if (reason) return { key: reason }

  const status = registry ? registry.status : 'server_unreachable'
  const stale = Boolean(registry && registry.stale)
  if (status === 'forbidden') return { key: NODEPOS_GUEST_TEXT }
  if (status === 'not_configured') return { key: NODEPOS_UNCONFIGURED_TEXT }
  if (status === 'empty') return { key: nodePosKeyText({ registryEmpty: true }) }
  if (status === 'server_unreachable') return { key: NODEPOS_SERVER_UNREACHABLE_TEXT, glance: true }
  if (status !== 'ok') return { key: NODEPOS_UNAVAILABLE_TEXT, glance: true }

  // Joined rather than concatenated, so a part that is not there takes its
  // separator with it: the stale warning is the whole line when the layer drew
  // fine, and follows the empty-view line when it did not.
  const line = (base) => [base, stale ? NODEPOS_STALE_TEXT : ''].filter(Boolean).join(' · ')
  if (drawn <= 0) return { key: line(NODEPOS_NONE_IN_VIEW_TEXT) }
  return { key: line('') }
}

// Maps one /api/nodes/positions response onto the status above. The server
// answers 403 below member and three distinct 503s (nodes.go), and collapsing
// them here would undo the reason they are distinct there.
//
// A 5xx without an error code is not the server speaking (#591): our server
// answers its registry outages as JSON, so a bare 5xx is a proxy in front of
// it giving up, or the server falling over.
export function registryStatusFor(httpStatus, errorCode) {
  if (httpStatus === 200) return 'ok'
  if (httpStatus === 403) return 'forbidden'
  if (errorCode === 'registry_not_configured') return 'not_configured'
  if (errorCode === 'registry_empty') return 'empty'
  if (httpStatus >= 500 && !errorCode) return 'server_unreachable'
  return 'unavailable'
}

// nextNotice decides what the line does on one draw, given the glance it last
// showed (#591). A line that is no glance is shown as it is, and clears the
// memory, so an outage that comes back after it ended shows again. A glance
// shows once, for NODEPOS_GLANCE_MS, and on the draws after it `text` is null:
// leave the line as the timer left it. The layer redraws on every pan and
// every tick, so without the memory an outage would flash on each of them.
export function nextNotice({ key = '', glance = false } = {}, glanced = '') {
  if (!glance) return { text: key, hideAfterMs: 0, glanced: '' }
  if (key !== glanced) return { text: key, hideAfterMs: NODEPOS_GLANCE_MS, glanced: key }
  return { text: null, hideAfterMs: 0, glanced }
}
