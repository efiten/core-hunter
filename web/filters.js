import { save } from './urlstate.js'
import { FILTER_PACKET_TYPES, SENDER_ID_CLASSES } from './packettypes.js'
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

// Cold-start timeframe (#492), the third answer here. #217 filled today
// 00:00-23:59, which met a newcomer with however many hours had passed since
// local midnight and, in most areas on most days, a blank map. #440 replaced
// it with nothing, so an empty range asked for everything. Neither described
// what the server returns: /api/heatmap caps at the newest 50 000 rows in the
// bbox, so "All time" quietly stops being all time as soon as one viewport
// holds more than that. 30 days is a window the server returns whole.
//
// It is applied in map.js, right after urlstate.load(), and only when BOTH
// bounds came back empty. Writing it here, before the restore, would hand a
// link carrying one bound the other half of a range it never asked for: with
// `to` pre-filled, /?from=now-6h stops being the open-ended range #285
// guarantees and silently becomes "Last 6 hours".
//
// The Clear button (resetFilters) still means today, deliberately: that is
// someone already using the map asking for a working default, not a first
// impression.

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

  // Sender-id class chips, wired exactly like the type row above: none active
  // means no filter, and the values travel verbatim as ?idclass= for the server
  // to bucket in SQL.
  const classHost = document.getElementById('f-idclass')
  for (const c of SENDER_ID_CLASSES) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'f-chip'; b.dataset.idclass = c.value; b.textContent = c.label
    b.addEventListener('click', () => {
      b.classList.toggle('active')
      save()
      if (window.__refresh) window.__refresh()
    })
    classHost.appendChild(b)
  }
  // The chips live in a popover, so the toggle carries the only visible sign
  // that this dimension is narrowed -- same job as #filter-pill-dot.
  const syncClassToggle = () => {
    const on = classHost.querySelectorAll('.f-chip.active').length > 0
    document.getElementById('f-idclass-toggle').classList.toggle('active', on)
  }
  classHost.addEventListener('click', syncClassToggle)
  window.__syncIdClassToggle = syncClassToggle
  window.currentIdClasses = () =>
    [...classHost.querySelectorAll('.f-chip.active')].map((b) => b.dataset.idclass).join(',')
  window.setIdClasses = (v) => {
    const want = new Set(String(v || '').split(',').filter(Boolean))
    for (const b of classHost.querySelectorAll('.f-chip')) b.classList.toggle('active', want.has(b.dataset.idclass))
    syncClassToggle()
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
  const unnamedCb = document.getElementById('f-unnamed')
  const unnamedLabel = unnamedCb.closest('label')
  const syncUnnamedActive = () => unnamedLabel.classList.toggle('active', unnamedCb.checked)
  unnamedCb.addEventListener('change', syncUnnamedActive)
  syncDirectActive()
  syncUnnamedActive()


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
    idclass: window.currentIdClasses(),
    // "No path" = zero path hashes (#138 semantics). Named for what it reads
    // rather than for what it was hoped to mean: the sender writes the path, so
    // this is the packet's own claim and not a measurement of distance. An
    // Amsterdam flood on 2026-08-24 claimed 1 to 37 hops for packets received
    // at -34 dBm, and the old label ("Direct only") promised the opposite.
    hops: document.getElementById('f-direct').checked ? '0' : '',
    // Everything the classifier could not attribute. Not an error state: an
    // unattributable reception is still a real measurement (#455), and it is
    // all a 1-byte-hash flood leaves behind.
    unnamed: document.getElementById('f-unnamed').checked ? '1' : '',
    // The viewer's ignore-list (#494), one repeated ?ignores= per node, same
    // pair shape as senderPairs and for the same #288 reason. map.js owns the
    // set, like it owns the picker selections.
    ignorePairs: (window.ignoredSenderParams && window.ignoredSenderParams()) || [],
  })

  // f-hunter's persist/refresh/change wiring now lives in map.js, alongside
  // the hunter picker itself (#290) -- same reasoning as the sender picker's
  // onChange (urlstate.save() + refresh() there, not a 'change' listener here).
  // Every input currentFilters() reads has to be in here, or its param only
  // reaches the server on the next refresh someone else triggers. That is not
  // visible on a relative range, where updateTimeRangeTimer (map.js) refreshes
  // every 10s and carries the param anyway (#503).
  for (const id of ['f-sender', 'f-from', 'f-to', 'f-direct', 'f-unnamed']) {
    const el = document.getElementById(id)
    el.addEventListener('change', () => window.__refresh && window.__refresh())
    if (id === 'f-sender') el.addEventListener('input', () => window.__refresh && window.__refresh())
    // The old focus->showPicker() shim is gone with #285: f-from/f-to are
    // hidden state carriers now, and the two datetime-local fields that
    // replaced them live inside the time-picker panel (map.js wires those).
  }
}
