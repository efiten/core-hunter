import { API_BASE } from './config.js'

const RANK = { guest: 0, hunter: 1, member: 2, admin: 3 }

export function roleRank(role) {
  return RANK[role] || 0
}
export function atLeast(role, min) {
  return roleRank(role) >= roleRank(min)
}
export function canSeeLocate(role) {
  return atLeast(role, 'member')
}
export function canSeeObserverPoints(role) {
  return atLeast(role, 'member')
}
export function isDegradedFor(role) {
  return !atLeast(role, 'member')
}
// The point layer is gated like Locate and the observer layers (#493). Below
// member /api/points returns the last 24 h and at most 500 rows
// (server/internal/httpapi/degrade.go, applyGuestWindowCap), so the layer came
// up thin or empty with nothing on the control to say why. The hex the map
// opens on is not windowed at all since #466, so the gate costs a visitor
// nothing they could otherwise see.
export function canSeePointLayer(role) {
  return atLeast(role, 'member')
}

// modeForRole holds a degraded role on hex whatever the URL asked for: ?mode=
// is restored before the role is known, so the gate has to be applied again
// once it is, the same way applyLocateGate re-runs for ?locate=1.
export function modeForRole(mode, role) {
  return canSeePointLayer(role) ? mode : 'hex'
}

// pointLayerReason is the line under the layer segments while Points and Both
// are disabled. Two audiences, the same split guestNotice makes: a guest has
// no account yet, a hunter has one and needs an admin to verify it, so "log
// in" is a dead end for them (#174).
export function pointLayerReason(role) {
  if (canSeePointLayer(role)) return null
  if (role === 'hunter') {
    return 'Individual receptions need a verified member account. An admin verifies you.'
  }
  return 'Individual receptions need an account. Log in to switch layers.'
}
// Server-side gating (degradeFilter/applyGuestWindowCap, httpapi/api.go +
// degrade.go) windows, caps, coarsens and pseudonymises everything a
// sub-member caller sees. A caller's own linked companions are exempt, but
// NOT unconditionally, and the difference decides what this copy may promise:
//
//   /api/points   unfiltered: own rows exact + full history, everyone else
//                 windowed/capped/pseudonymised (the handler's default branch)
//   /api/heatmap  the exemption is `ownFull := len(f.Hunter) == 1 &&
//                 ownsCompanion(...)` — unfiltered, own rows take the 24 h
//                 window and the z>12 cap with everyone else's; degradePoints
//                 only spares them the coordinate snap and the pseudonym
//
// The website's cold default mode is hex (map.js), i.e. the heatmap, so a
// hunter on first load is on the layer where their own captures are NOT in
// full until they filter the hunter picker to themselves. Hence "once you
// filter to it" in the notice — an unqualified "your own companion in full"
// is wrong on the surface they actually land on.
//
// The call to action differs too: a guest isn't logged in yet, but a hunter
// already is and needs member verification instead (#174).
//
// The two layers said different things about time (#440), so the copy had to
// as well: coverage (the hex heat, and the layer the map opens on) is not
// windowed for anyone, while the 24 h window is only on individual receptions
// (/api/points, applyGuestWindowCap).
//
// Since #493 there is only one layer down here, so the sentence about
// individual receptions is about the ticker, which keeps its own /api/points
// feed. Naming the ticker rather than "individual receptions" in the abstract
// is what makes it findable: it is the thing on screen the 24 h applies to.
//
// "not named" rather than "anonymised" for the heat, because they are absent
// from it rather than pseudonymised: the per-cell hunter list is withheld
// entirely below member, which is what let the window go (#280).
// "Log in to see more" is a dead end for a visitor who has never had an account
// (#490), and the map cannot create one: /api/auth/register rejects a body
// without a companion_pubkey (httpapi/auth.go). What answers it is #rx-cta, the
// Start mapping link standing in the bar a few pixels away, plus the login
// card's own footer. Not this line: #bar is flex-wrap and the notice shares its
// row with the SF counts, so naming the RX webapp here cost a whole extra bar
// row (measured at 1440px: 800px of notice against 703px).
export function guestNotice(role) {
  if (atLeast(role, 'member')) return null
  if (role === 'hunter') {
    return 'Hunter view: ~1 km cells, hunters not named, no time limit. Ticker shows the last 24 h; filter to your own companion to see those in full. An admin verifies you as a member for the point layer and the rest.'
  }
  return 'Guest view: ~1 km cells, hunters not named, no time limit. Ticker shows the last 24 h. Log in for individual receptions.'
}
export async function fetchMe() {
  try {
    const r = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'same-origin' })
    if (!r.ok) return { role: 'guest' }
    return await r.json()
  } catch (_) {
    return { role: 'guest' }
  }
}
