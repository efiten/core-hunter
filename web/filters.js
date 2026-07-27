import { API_BASE } from './config.js'
import { save } from './urlstate.js'
import { FILTER_PACKET_TYPES } from './packettypes.js'

// Pseudonym-aware label for a #f-hunter <option>: guests get `hunter_name`
// (server-issued "Hunter <N>" pseudonym), members+ get the real name; unnamed
// falls back to an 8-char pubkey prefix.
export function hunterOptionLabel(h) {
  return `${h.hunter_name || h.hunter_pubkey.slice(0, 8)} (${h.count})`
}

// Row count for #f-hunter's expanded listbox (#240) — show every option up
// to a cap so a long hunter list doesn't take over the screen, but never
// fewer than 2 rows (even for 0-1 options) so it still reads as a listbox
// rather than a single-line dropdown.
export function hunterListboxSize(optionCount) {
  return Math.min(Math.max(optionCount, 2), 8)
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
  for (const o of document.getElementById('f-hunter').options) o.selected = false
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
    // The shared/saved selection can only be applied once its options exist
    // (options arrive async). Re-assert it and fire change so the view + URL pick it
    // up. Read the value captured before load (index.html), not initial('hunter')
    // here -- by now urlstate.load()'s save() has already normalized the URL/storage
    // to the still-empty live selection and would return '' (#196).
    const want = new Set(String(window.__initialHunter || '').split(',').filter(Boolean))
    if (want.size) {
      for (const o of sel.options) o.selected = want.has(o.value)
      sel.dispatchEvent(new Event('change'))
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

  // Direct-only checkbox: highlight its label when checked, mirroring app's
  // .fs-row.active pattern for the same control (#225 visual parity).
  const directCb = document.getElementById('f-direct')
  const directLabel = directCb.closest('label')
  const syncDirectActive = () => directLabel.classList.toggle('active', directCb.checked)
  directCb.addEventListener('change', syncDirectActive)
  syncDirectActive()

  defaultToday()

  window.__resetFilters = resetFilters

  // getters/setter used by currentFilters and the urlstate registration (map.js);
  // a native <select multiple> mirrors the f-types chip pattern above.
  window.currentHunters = () =>
    [...document.getElementById('f-hunter').selectedOptions].map((o) => o.value).join(',')
  window.setHunters = (v) => {
    const want = new Set(String(v || '').split(',').filter(Boolean))
    for (const o of document.getElementById('f-hunter').options) o.selected = want.has(o.value)
  }

  window.currentFilters = () => ({
    hunter: window.currentHunters(),
    sender: document.getElementById('f-sender').value.trim(),
    from: localToUTC(document.getElementById('f-from').value),
    to: localToUTC(document.getElementById('f-to').value),
    types: window.currentTypes(),
    // direct-only = zero-hop (#138 semantics); empty string drops the param
    hops: document.getElementById('f-direct').checked ? '0' : '',
  })

  // f-hunter is registered directly with urlstate (map.js), not via bindControl
  // (a <select multiple>'s .value only returns the first selection) -- persist
  // it explicitly here, same as the f-types chips do.
  const hunterSel = document.getElementById('f-hunter')
  hunterSel.addEventListener('change', save)

  // Expand to a multi-row listbox on focus (#240) so the multi-select is
  // discoverable/usable without already knowing the ctrl/cmd+click gesture;
  // collapse back to the compact 1-line footprint on blur.
  hunterSel.addEventListener('focus', () => {
    hunterSel.size = hunterListboxSize(hunterSel.options.length)
    hunterSel.classList.add('expanded')
  })
  hunterSel.addEventListener('blur', () => {
    hunterSel.removeAttribute('size')
    hunterSel.classList.remove('expanded')
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
