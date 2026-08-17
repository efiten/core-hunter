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
// degrade.go) applies the same 24h/500-row/coarse-position/anonymised-hunter
// limits to guest AND hunter roles alike -- both are below "member". The
// call to action differs: a guest isn't logged in yet, but a hunter already
// is and needs member verification instead (#174).
export function guestNotice(role) {
  if (atLeast(role, 'member')) return null
  if (role === 'hunter') {
    // Your own companion's captures come back exact and full-history from the
    // server (httpapi/api.go, ownsCompanion); only other hunters are windowed,
    // coarsened and pseudonymised. The old copy said "hunter view: last 24 h"
    // flat out, which understated what a hunter already has and left the way
    // past it unstated (#316).
    return 'Hunter view: your own companion in full. Other hunters: last 24 h, coarse ~1 km positions, anonymised — an admin verifies you as a member to see everyone in full.'
  }
  return 'Guest view: last 24 h, coarse ~1 km positions, hunters anonymised. Log in to see more.'
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
