import { API_BASE } from './config.js'

const localToUTC = (v) => (v ? new Date(v).toISOString() : '') // datetime-local is local time → ISO UTC

// Format a Date as a local-time `YYYY-MM-DDTHH:MM` string for datetime-local inputs.
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Default the timeframe to today (local): 00:00 → 23:59.
function defaultToday() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59)
  const from = document.getElementById('f-from')
  const to = document.getElementById('f-to')
  if (!from.value) from.value = toLocalInput(start)
  if (!to.value) to.value = toLocalInput(end)
}
defaultToday()

window.currentFilters = () => ({
  hunter: document.getElementById('f-hunter').value,
  sender: document.getElementById('f-sender').value.trim(),
  from: localToUTC(document.getElementById('f-from').value),
  to: localToUTC(document.getElementById('f-to').value),
})

async function loadHunters() {
  try {
    const r = await fetch(`${API_BASE}/api/hunters`); const d = await r.json()
    const sel = document.getElementById('f-hunter')
    for (const h of d.hunters || []) {
      const o = document.createElement('option')
      o.value = h.hunter_pubkey
      o.textContent = `${h.hunter_name || h.hunter_pubkey.slice(0, 8)} (${h.count})`
      sel.appendChild(o)
    }
  } catch (_) {}
}

for (const id of ['f-hunter', 'f-sender', 'f-from', 'f-to']) {
  const el = document.getElementById(id)
  el.addEventListener('change', () => window.__refresh && window.__refresh())
  if (id === 'f-sender') el.addEventListener('input', () => window.__refresh && window.__refresh())
  // datetime-local only opens the native picker via its tiny calendar icon;
  // call showPicker() on focus so a click anywhere on the field opens it.
  if ((id === 'f-from' || id === 'f-to') && typeof el.showPicker === 'function') {
    el.addEventListener('focus', () => { try { el.showPicker() } catch (_) {} })
  }
}
loadHunters()
