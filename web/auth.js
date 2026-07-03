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
export function guestNotice(role) {
  if (atLeast(role, 'member')) return null
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
