import { SOUND_MODES } from './sound.js'
import { VIEW_STATES, viewKey } from './maplayers.js'

// readStored returns the raw stored value for key, or null when it is absent
// or storage is unavailable. Reading localStorage throws SecurityError where
// storage is blocked (Safari with cookies off, a WebView with storage
// disabled, some private-browsing modes); these loaders run during module
// evaluation, so an unguarded throw aborts app.js and blanks the app (#338).
function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch (_) {
    return null
  }
}

// Attenuator setting (dB, non-positive: 0/-10/-20/-30). Persisted; added back to
// plotted RSSI so the picture stays consistent when an external attenuator is on.
export function loadAttenuator() {
  const v = Number(readStored('core-hunter-attenuator'))
  return v === -10 || v === -20 || v === -30 ? v : 0
}

// Sound mode (#145): off / rxtx / full, cycled by the sound FAB. Persisted
// like the attenuator; unknown stored values fall back to off. Also migrates
// the pre-#255 4-state values (a couple of days of dogfooding only, never
// released) onto the collapsed 3-state set.
const SOUND_MODE_MIGRATION = { ping: 'rxtx', ambient: 'full', music: 'full' }
export function loadSoundMode() {
  const v = readStored('core-hunter-sound')
  // Object.hasOwn, not a plain truthy lookup: an object literal answers for
  // its prototype's keys, so a stored 'toString' would be returned as a mode.
  if (Object.hasOwn(SOUND_MODE_MIGRATION, v)) return SOUND_MODE_MIGRATION[v]
  return SOUND_MODES.includes(v) ? v : 'off'
}

// Index into VIEW_STATES for the persisted view (#258). No/corrupt stored
// value falls back to both/2D — the app's cold default before that merge
// (huntmap.js's own mode/mode3D defaults), not index 0.
export function loadViewIndex() {
  const v = readStored('core-hunter-view')
  const i = VIEW_STATES.findIndex((s) => viewKey(s) === v)
  return i === -1 ? 1 : i
}

// isSettingsActive reports whether any setting under the Settings sheet
// differs from its default — i.e. something that changes behaviour is on.
// Drives the settings button's active-dot, mirroring isFilterActive (filters.js).
export function isSettingsActive({ attenuatorDb } = {}) {
  if (attenuatorDb) return true
  return false
}
