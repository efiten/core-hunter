// app/src/auth.js — pure auth logic + thin fetch wrappers (no DOM)

export function validateRegistration({ username, password, companionPubkey }) {
  const errors = []
  if (!username || !username.trim()) errors.push('username_invalid')
  if (!password || password.length < 10) errors.push('password_too_short')
  if (!companionPubkey) errors.push('companion_required')
  return errors
}

export function buildRegisterBody({ username, password, email, companionPubkey }) {
  const body = { username, password, companion_pubkey: companionPubkey }
  if (email && email.trim()) body.email = email.trim()
  return body
}

export function buildLoginBody({ username, password, remember }) {
  return { username, password, remember: !!remember }
}

export function buildLinkBody(companionPubkey) {
  return { companion_pubkey: companionPubkey }
}

export async function fetchMe() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    if (!r.ok) return { role: 'guest' }
    return await r.json()
  } catch (_) {
    return { role: 'guest', offline: true }
  }
}

export async function postAuth(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let data = {}
    try { data = await r.json() } catch (_) { data = {} }
    return { ok: r.ok, status: r.status, data }
  } catch (_) {
    return { ok: false, status: 0, data: { error: 'network' } }
  }
}

export function accountDisplayState(me, rxPubkey) {
  const guest = !me || me.role === 'guest' || !me.username
  if (guest) {
    return {
      label: 'Not logged in',
      loggedIn: false,
      showLogin: true,
      showRegister: true,
      showLogout: false,
      showLink: false,
    }
  }
  const companions = me.companions || []
  return {
    label: `${me.username} (${me.role})`,
    loggedIn: true,
    showLogin: false,
    showRegister: false,
    showLogout: true,
    showLink: !!rxPubkey && !companions.includes(rxPubkey),
  }
}
