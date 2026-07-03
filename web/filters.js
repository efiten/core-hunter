import { API_BASE } from './config.js'
import { initial, save } from './urlstate.js'

// Same packet-type set as the app's filter sheet (parity, #142).
const FILTER_PACKET_TYPES = [
  { value: 'Advert',      label: 'Advert' },
  { value: 'GroupText',   label: 'Channel' },
  { value: 'Response',    label: 'Response' },
  { value: 'Request',     label: 'Request' },
  { value: 'TextMessage', label: 'Direct msg' },
  { value: 'Ack',         label: 'Ack' },
  { value: 'Trace',       label: 'Trace' },
]

// Pseudonym-aware label for a #f-hunter <option>: guests get `hunter_name`
// (server-issued "Hunter <N>" pseudonym), members+ get the real name; unnamed
// falls back to an 8-char pubkey prefix.
export function hunterOptionLabel(h) {
  return `${h.hunter_name || h.hunter_pubkey.slice(0, 8)} (${h.count})`
}

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

// Reset every filter to its default: all hunters, no sender, timeframe = today.
// Exposed for the "Clear" button; map.js handles the layer/locate/redraw side.
function resetFilters() {
  document.getElementById('f-hunter').value = ''
  const s = document.getElementById('f-sender'); s.value = ''; s.title = ''
  const now = new Date()
  document.getElementById('f-from').value = toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0))
  document.getElementById('f-to').value = toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59))
}

async function loadHunters() {
  try {
    const r = await fetch(`${API_BASE}/api/hunters`); const d = await r.json()
    const sel = document.getElementById('f-hunter')
    for (const h of d.hunters || []) {
      const o = document.createElement('option')
      o.value = h.hunter_pubkey
      o.textContent = hunterOptionLabel(h)
      sel.appendChild(o)
    }
    // The shared/saved hunter can only be applied once its option exists (options
    // arrive async). Re-assert it and fire change so the view + URL pick it up.
    const want = initial('hunter', '')
    if (want && sel.value !== want) {
      sel.value = want
      if (sel.value === want) sel.dispatchEvent(new Event('change'))
    }
  } catch (_) {}
}

// All DOM wiring below is guarded so this module can be imported under Vitest
// (no document/window) to unit-test the pure helpers above; in a browser
// `document` always exists, so behaviour is unchanged.
if (typeof document !== 'undefined') {
  // Packet-type toggle chips: none active = all types (no filter).
  const typesHost = document.getElementById('f-types')
  for (const t of FILTER_PACKET_TYPES) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'f-chip'; b.dataset.type = t.value; b.textContent = t.label
    b.addEventListener('click', () => {
      b.classList.toggle('active')
      save()
      if (window.__refresh) window.__refresh()
    })
    typesHost.appendChild(b)
  }

  // getters/setter used by currentFilters and the urlstate registration (map.js).
  window.currentTypes = () =>
    [...typesHost.querySelectorAll('.f-chip.active')].map((b) => b.dataset.type).join(',')
  window.setTypes = (v) => {
    const want = new Set(String(v || '').split(',').filter(Boolean))
    for (const b of typesHost.querySelectorAll('.f-chip')) b.classList.toggle('active', want.has(b.dataset.type))
  }

  defaultToday()

  window.__resetFilters = resetFilters

  window.currentFilters = () => ({
    hunter: document.getElementById('f-hunter').value,
    sender: document.getElementById('f-sender').value.trim(),
    from: localToUTC(document.getElementById('f-from').value),
    to: localToUTC(document.getElementById('f-to').value),
    types: window.currentTypes(),
    // direct-only = zero-hop (#138 semantics); empty string drops the param
    hops: document.getElementById('f-direct').checked ? '0' : '',
  })

  for (const id of ['f-hunter', 'f-sender', 'f-from', 'f-to', 'f-direct']) {
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
}
