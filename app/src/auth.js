// app/src/auth.js — pure auth logic + thin fetch wrappers (no DOM)

export function validateRegistration({ username, password, companionPubkey }) {
  const errors = []
  if (!username || !username.trim()) errors.push('username_invalid')
  if (!password || password.length < 10) errors.push('password_too_short')
  if (!companionPubkey) errors.push('companion_required')
  return errors
}

export function buildRegisterBody({ username, password, email, companionPubkey, proof }) {
  const body = { username, password, companion_pubkey: companionPubkey, ...proof }
  if (email && email.trim()) body.email = email.trim()
  return body
}

export function buildLoginBody({ username, password, remember }) {
  return { username, password, remember: !!remember }
}

export function buildLinkBody(companionPubkey, proof) {
  return { companion_pubkey: companionPubkey, ...proof }
}

// companionProof shows the server we hold the companion, not just its public
// pubkey: the radio signs a challenge the server issued for that pubkey
// (server/internal/auth/companionproof.go). `sign` is (bytes) =>
// Promise<Uint8Array(64)>. null means no challenge or no signature.
export async function companionProof({ pubkeyHex, sign, post = postAuth }) {
  const r = await post('/api/auth/companion-challenge', { companion_pubkey: pubkeyHex })
  const challenge = r.ok && r.data && r.data.challenge
  if (!challenge) return null
  try {
    const sig = await sign(new TextEncoder().encode('core-hunter-link:' + challenge))
    return { challenge, signature: Array.from(sig, (x) => x.toString(16).padStart(2, '0')).join('') }
  } catch (_) {
    return null
  }
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

export function submitLabelForMode(mode) {
  if (mode === 'login') return 'Log in'
  if (mode === 'register') return 'Create account'
  return 'Submit'
}

// Username and role are separate fields, not a "alice (hunter)" label (#539):
// the sheet renders the role as a chip next to the name, and the one thing
// that decides what you see on the map should be readable at a glance.
export function accountDisplayState(me, rxPubkey) {
  const guest = !me || me.role === 'guest' || !me.username
  if (guest) {
    return {
      username: null,
      role: null,
      loggedIn: false,
      showLogin: true,
      showRegister: true,
      showLogout: false,
      showLink: false,
    }
  }
  const companions = me.companions || []
  return {
    username: me.username,
    role: me.role,
    loggedIn: true,
    showLogin: false,
    showRegister: false,
    showLogout: true,
    showLink: !!rxPubkey && !companions.includes(rxPubkey),
  }
}
