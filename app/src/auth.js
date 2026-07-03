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
