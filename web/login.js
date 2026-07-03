import { API_BASE } from './config.js'
import { fetchMe } from './auth.js'

const $ = (id) => document.getElementById(id)

async function doLogin() {
  const err = $('login-error')
  err.hidden = true
  const body = {
    username: $('login-user').value,
    password: $('login-pass').value,
    remember: $('login-remember').checked,
  }
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) { err.hidden = false; return null }
  return await r.json()
}

async function doLogout() {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'same-origin' })
}

export async function initAuthBar(onChange) {
  const btn = $('auth-btn')
  const modal = $('login-modal')
  let me = await fetchMe()
  const render = () => {
    btn.textContent = me.username ? me.username : 'Log in'
  }
  render()
  onChange(me)

  btn.addEventListener('click', async () => {
    if (me.username) {
      await doLogout()
      me = await fetchMe()
      render(); onChange(me)
    } else {
      modal.hidden = false
      $('login-user').focus()
    }
  })
  $('login-cancel').addEventListener('click', () => { modal.hidden = true })
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const res = await doLogin()
    if (!res) return
    modal.hidden = true
    me = await fetchMe()
    render(); onChange(me)
  })
}
