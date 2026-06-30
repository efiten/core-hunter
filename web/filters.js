import { API_BASE } from './config.js'

const localToUTC = (v) => (v ? new Date(v).toISOString() : '') // datetime-local is local time → ISO UTC

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
}
loadHunters()
