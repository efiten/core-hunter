import { API_BASE } from './config.js'
import { fetchMe } from './auth.js'

export function shapeUsers(resp) {
  return (resp.users || []).map(u => ({
    id: u.id,
    username: u.username,
    email: u.email || '',
    role: u.role,
    status: u.status,
    companions: (u.companions || []).length,
    lastLogin: u.last_login_at || '—',
  }))
}
// Escape a value for safe interpolation into innerHTML. Usernames/emails/etc.
// are server-supplied strings that ultimately trace back to self-registration,
// so they must never be inserted into markup unescaped (stored-XSS).
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function shapeAudit(resp) {
  return (resp.events || []).map(e => ({
    id: e.id,
    at: e.at,
    line: `${e.actor} → ${e.action} → ${e.target} (${e.ip})`,
  }))
}

async function api(path, opts) {
  const r = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...opts })
  return r
}

async function loadUsers() {
  const r = await api('/api/admin/users')
  const rows = shapeUsers(await r.json())
  const tbody = document.getElementById('users-body')
  tbody.innerHTML = ''
  for (const u of rows) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td>
      <td>${escapeHtml(u.status)}</td><td>${u.companions}</td><td>${escapeHtml(u.lastLogin)}</td>
      <td class="row-actions" data-id="${escapeHtml(u.id)}" data-status="${escapeHtml(u.status)}"></td>`
    const cell = tr.querySelector('.row-actions')
    addRowActions(cell, u)
    tbody.appendChild(tr)
  }
}

function addRowActions(cell, u) {
  const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', fn); cell.appendChild(b) }
  mk(u.status === 'disabled' ? 'Enable' : 'Disable', () =>
    patchUser(u.id, { status: u.status === 'disabled' ? 'active' : 'disabled' }))
  mk('Make member', () => patchUser(u.id, { role: 'member' }))
  mk('Make admin', () => patchUser(u.id, { role: 'admin' }))
  mk('Send reset', () => resetMail(u.username))
}

async function patchUser(id, body) {
  const r = await api(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 409) { alert('Refused: would leave no active admin.'); return }
  await loadUsers()
}
async function resetMail(username) {
  await api('/api/auth/reset-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: username }) })
  alert('Reset mail sent (if the account has an email).')
}

async function invite(ev) {
  ev.preventDefault()
  const body = {
    username: document.getElementById('inv-user').value,
    email: document.getElementById('inv-email').value,
    role: document.getElementById('inv-role').value,
  }
  await api('/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await loadUsers()
}

async function loadAudit() {
  const r = await api('/api/admin/audit?limit=100')
  const rows = shapeAudit(await r.json())
  const ul = document.getElementById('audit-list')
  ul.innerHTML = ''
  for (const e of rows) {
    const li = document.createElement('li')
    li.textContent = `${e.at}  ${e.line}`
    ul.appendChild(li)
  }
}

async function boot() {
  const me = await fetchMe()
  if (me.role !== 'admin') {
    document.body.innerHTML = '<p style="color:var(--ch-text)">Admin only — log in on the map first.</p>'
    return
  }
  document.getElementById('invite-form').addEventListener('submit', invite)
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.hidden = true)
    document.getElementById(b.dataset.tab).hidden = false
    if (b.dataset.tab === 'tab-audit') loadAudit()
  }))
  await loadUsers()
}

// only auto-boot in the browser, not under Vitest
if (typeof document !== 'undefined' && document.getElementById('users-body')) boot()
