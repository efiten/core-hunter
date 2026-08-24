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
// The two layers now say different things about time (#440), so the copy has
// to as well. Coverage — the hex heat, and the layer the map opens on — is
// all-time for everyone; the 24 h window is only on the individual receptions
// (/api/points, applyGuestWindowCap). Saying "last 24 h" flat, as this did
// before #440, described the layer a visitor is NOT looking at and undersold
// the one they are.
//
// "not named" rather than "anonymised" for the heat, because they are absent
// from it rather than pseudonymised: the per-cell hunter list is withheld
// entirely below member, which is what let the window go (#280).
export function guestNotice(role) {
  if (atLeast(role, 'member')) return null
  if (role === 'hunter') {
    return 'Hunter view: all-time coverage, coarse ~1 km, hunters not named; individual receptions show the last 24 h — filter to your own companion to see those in full. An admin verifies you as a member to see everyone in full.'
  }
  return 'Guest view: all-time coverage, coarse ~1 km, hunters not named; individual receptions show the last 24 h. Log in to see more.'
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
