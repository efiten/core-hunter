import { SOUND_MODES } from './sound.js'
import { VIEW_STATES, viewKey } from './maplayers.js'
import { THEME_PREFS } from './theme.js'
import { EXAGGERATION_STEPS, DEFAULT_EXAGGERATION } from './terrain.js'

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

// Terrain exaggeration (#396), one of EXAGGERATION_STEPS; anything else is
// the decided default (#394). Display-only, like the attenuator.
export function loadExaggeration() {
  const v = Number(readStored('core-hunter-exaggeration'))
  return EXAGGERATION_STEPS.includes(v) ? v : DEFAULT_EXAGGERATION
}

// Terrain on/off, the FAB's state (#396). Off unless switched on (Kasper,
// 2026-09-06): the DEM is a third party's tiles fetched for the viewport, so
// the button is the opt-in, and the choice persists under its own key.
export function loadTerrainOn() {
  return readStored('core-hunter-terrain') === '1'
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

// Theme preference (#563): 'system' / 'dark' / 'light'. Before this the theme
// was not stored at all, so a chosen light theme lasted until the next reload
// and index.html's hardcoded dark won again. An unknown or absent value is
// 'system', which is what resolveTheme() treats it as anyway; validating here
// as well is what lets the control show which of the three is selected.
export function loadThemePref() {
  const v = readStored('core-hunter-theme')
  return THEME_PREFS.includes(v) ? v : 'system'
}

// Index into VIEW_STATES for the persisted view (#258). No/corrupt stored
// value falls back to both/2D — the app's cold default before that merge
// (huntmap.js's own mode/mode3D defaults), not index 0.
export function loadViewIndex() {
  const v = readStored('core-hunter-view')
  const i = VIEW_STATES.findIndex((s) => viewKey(s) === v)
  return i === -1 ? 1 : i
}

// Id of the newest changelog entry the reader has acknowledged (#422), or null
// when they never have — a first run records it silently, so nobody is shown
// entries from before they arrived.
//
// A separate key from the pre-#422 one on purpose. That key held a VERSION
// string and this one holds an entry id, and there is no reliable way to tell
// '1.10.0' from a date-prefixed slug once they share a slot. Keeping them apart
// is what lets migratedSeenId see the difference between "never been here" and
// "was here under the old scheme".
export function loadChangelogSeen() {
  return readStored('core-hunter-changelog-entry')
}

export function saveChangelogSeen(entryId) {
  try { localStorage.setItem('core-hunter-changelog-entry', entryId) } catch (_) {}
}

// The pre-#422 acknowledgement: a version string, written by the panel that
// listed releases. Read-only now, and only to answer "has this reader used the
// old panel?". Never written again, so it ages out on its own.
export function loadLegacyChangelogAck() {
  return readStored('core-hunter-changelog-seen')
}

// isSettingsActive reports whether the settings button deserves its dot: any
// setting under the sheet differing from its default, or release notes the
// reader has not opened yet (#421). Mirrors isFilterActive (filters.js).
//
// Unread notes ride the same dot deliberately. A second indicator on a 40px
// button reads as noise, and the two mean the same thing to the person looking
// at it — there is something behind this button you have not dealt with. What
// it is, is one tap away, and the tab carries its own dot to say which.
export function isSettingsActive({ attenuatorDb, unseenChangelog, exaggeration } = {}) {
  if (attenuatorDb) return true
  if (unseenChangelog) return true
  if (exaggeration != null && exaggeration !== DEFAULT_EXAGGERATION) return true
  return false
}

// initialSettingsTab picks the tab the sheet opens on. Unread release notes
// win once: opening that tab acknowledges them (saveChangelogSeen), so the
// next open finds unseenChangelog false and lands back on the first tab.
// Without that write this would strand the reader on the notes every time.
// The first tab is Status since #539 — the web copy's is Settings, so only
// the unread-notes decision is shared (web/parity.test.js).
export function initialSettingsTab({ unseenChangelog } = {}) {
  return unseenChangelog ? 'whatsnew' : 'status'
}
