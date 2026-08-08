import { save } from './urlstate.js'
import { FILTER_PACKET_TYPES } from './packettypes.js'
import { senderParams } from './targetpicker.js'
import { resolveTimeValue } from './timerange.js'

// from/to hold either an absolute datetime-local string or a relative token
// ("now-6h") since #285 -- resolveTimeValue handles both, and is the one place
// either becomes the ISO-UTC the API expects.

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
// The hunter picker's own selection lives in map.js (like the sender picker,
// #223/#290), so map.js's clear-filters handler clears it directly.
// Exposed for the "Clear" button; map.js handles the layer/locate/redraw side.
function resetFilters() {
  const s = document.getElementById('f-sender'); s.value = ''; s.title = ''
  const now = new Date()
  document.getElementById('f-from').value = toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0))
  document.getElementById('f-to').value = toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59))
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

  // getters/setter used by currentFilters and the urlstate registration
  // (map.js). The hunter picker itself is created in map.js (like the sender
  // picker, #290) -- these delegate through window.selectedHunterIds /
  // window.setHunterSelection, set once the picker exists, same lazy-
  // indirection pattern already used below for window.selectedSenderIds.
  window.currentHunters = () => (window.selectedHunterIds ? window.selectedHunterIds() : []).join(',')
  window.setHunters = (v) => { if (window.setHunterSelection) window.setHunterSelection(v) }

  window.currentFilters = () => ({
    hunter: window.currentHunters(),
    // Two independent inputs on two params (#223): the picker's selection and
    // the typed leading-prefix search. #f-sender no longer doubles as the
    // selection store, so an id containing punctuation never has to survive a
    // delimiter round-trip anywhere (#288).
    senderPairs: senderParams({
      ids: (window.selectedSenderIds && window.selectedSenderIds()) || [],
      prefix: document.getElementById('f-sender').value,
    }),
    // #285 resolves relative tokens (now-1h, now/d) as well as absolute values,
    // so it supersedes the plain localToUTC conversion here.
    from: resolveTimeValue(document.getElementById('f-from').value, Date.now()),
    to: resolveTimeValue(document.getElementById('f-to').value, Date.now()),
    types: window.currentTypes(),
    // direct-only = zero-hop (#138 semantics); empty string drops the param
    hops: document.getElementById('f-direct').checked ? '0' : '',
  })

  // f-hunter's persist/refresh/change wiring now lives in map.js, alongside
  // the hunter picker itself (#290) -- same reasoning as the sender picker's
  // onChange (urlstate.save() + refresh() there, not a 'change' listener here).
  for (const id of ['f-sender', 'f-from', 'f-to', 'f-direct']) {
    const el = document.getElementById(id)
    el.addEventListener('change', () => window.__refresh && window.__refresh())
    if (id === 'f-sender') el.addEventListener('input', () => window.__refresh && window.__refresh())
    // The old focus->showPicker() shim is gone with #285: f-from/f-to are
    // hidden state carriers now, and the two datetime-local fields that
    // replaced them live inside the time-picker panel (map.js wires those).
  }
}
