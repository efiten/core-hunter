import { API_BASE } from './config.js'

export function parseResetToken(search) {
  return new URLSearchParams(search).get('token')
}

export function validateNewPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10
}

export function buildResetBody(token, pw) {
  return { token, new_password: pw }
}

async function submit(ev) {
  ev.preventDefault()
  const token = parseResetToken(location.search)
  const pw = document.getElementById('rp-pass').value
  const err = document.getElementById('rp-error')
  const ok = document.getElementById('rp-ok')
  err.hidden = true; ok.hidden = true
  if (!validateNewPassword(pw)) {
    err.textContent = 'Password must be at least 10 characters.'
    err.hidden = false
    return
  }
  const r = await fetch(`${API_BASE}/api/auth/reset`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildResetBody(token, pw)),
  })
  if (r.status === 204) { ok.hidden = false } else {
    const j = await r.json().catch(() => ({}))
    err.textContent = j.error === 'password_too_short' ? 'Password must be at least 10 characters.' : 'Invalid or expired link.'
    err.hidden = false
  }
}

if (typeof document !== 'undefined' && document.getElementById('reset-form')) {
  document.getElementById('reset-form').addEventListener('submit', submit)
}
