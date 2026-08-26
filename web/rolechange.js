// Telling someone their verification came through (#530).
//
// Two surfaces promise it -- guestNotice('hunter') and, since #491, the login
// card -- and nothing carried the promise to its end. SetRoleStatus changes the
// role and writes an audit row (server/internal/httpapi/admin.go:133); that is
// the whole of it. And the role is read once, at load, so a hunter who leaves
// the map open while waiting keeps seeing "Hunter view" indefinitely after
// being verified, which reads as nothing having happened.
//
// The last-seen role lives in localStorage, the shape whatsnew.js already uses
// for its last-seen entry. That needs no schema and no email address, which
// matters: 5 of 16 users have an address on file, and of the four hunters
// waiting today exactly one does. Mail is the addition, not the mechanism.
import { roleRank } from './auth.js'

const SEEN_KEY = 'ch-role-seen'

export function loadSeenRole() {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch (_) {
    return null
  }
}

export function saveSeenRole(role) {
  try {
    localStorage.setItem(SEEN_KEY, String(role || ''))
  } catch (_) {
    /* private mode, or storage full: the notice is not worth failing a load for */
  }
}

// roleRose is deliberately silent when nothing is stored yet. With no previous
// value a promotion is indistinguishable from someone simply arriving, and
// announcing "an admin has verified you" to a member of six months reads as a
// bug rather than a courtesy. The first visit records, it does not announce.
//
// Only upwards: a demotion is somebody else's decision to explain, and a cheery
// banner is the wrong way to hear it.
export function roleRose(seen, current) {
  if (!seen) return false
  return roleRank(current) > roleRank(seen)
}

// What the reader is told. Each line names what actually opened up, because
// "your role changed" tells them nothing they can act on.
export function roleNotice(role) {
  switch (role) {
    case 'member':
      return 'An admin has verified you as a member. You now see the full history, hunters by name, and Locate.'
    case 'admin':
      return 'You now have admin access.'
    case 'hunter':
      return 'You are registered as a hunter. Filter to your own companion to see its receptions in full.'
    default:
      return ''
  }
}
