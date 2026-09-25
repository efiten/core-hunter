import { SOUND_MODES } from './sound.js'
import { VIEW_STATES, viewKey } from './maplayers.js'
import { THEME_PREFS } from './theme.js'
import { EXAGGERATION_STEPS, DEFAULT_EXAGGERATION } from './terrain.js'
import { parseBrokerPrefs } from './brokers.js'

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

// The hunter's own brokers and the ones they switched off (#554). Kept on the
// phone; config.json stays the site's list.
export function loadBrokerPrefs() {
  return parseBrokerPrefs(readStored('core-hunter-brokers'))
}

export function saveBrokerPrefs(prefs) {
  try { localStorage.setItem('core-hunter-brokers', JSON.stringify(prefs)) } catch (_) {}
}

// Tokens the companion signed for brokers it signs in to (#554), by broker id.
// Stored so the backlog can still go out after the radio is unplugged; a token
// is good for a day and only for the host it names.
export function loadBrokerTokens() {
  try {
    const raw = JSON.parse(readStored('core-hunter-broker-tokens'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch (_) { return {} }
}

export function saveBrokerTokens(tokens) {
  try { localStorage.setItem('core-hunter-broker-tokens', JSON.stringify(tokens)) } catch (_) {}
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

// Introduce my node to targets (#576, Share my node name until #636): the first setting that puts the hunter's own
// identity on air. Off unless the stored value says on, exactly: a missing or
// malformed slot must never read as "share".
export function loadShareName() {
  return readStored('core-hunter-share-name') === '1'
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

// isSettingsActive reports whether the settings button is tinted: a setting
// that changes the measurement is off its default. That is the attenuator and
// nothing else (#635, Kasper 2026-09-12): the exaggeration is display, the
// introduction is transmission, and unread notes are news (hasNews). It used
// to light one dot for all four, and a dot that stands for four things says
// nothing about which.
export function isSettingsActive({ attenuatorDb } = {}) {
  return Boolean(attenuatorDb)
}

// hasNews reports whether the button carries the news dot (#635): release
// notes not read yet, or a newer build waiting (update.js, checked at start).
// The What's new tab carries its own dot for the first half, and the Reload
// button its own mark for the second, once the sheet is open.
export function hasNews({ unseenChangelog, updateAvailable } = {}) {
  return Boolean(unseenChangelog || updateAvailable)
}

// settingsButtonLabel is the button's accessible name: the tint and the dot are
// colour only, so the name says what each stands for.
export function settingsButtonLabel(state = {}) {
  const parts = ['Menu, connection status']
  if (isSettingsActive(state)) parts.push('attenuator on')
  if (hasNews(state)) parts.push("what's new")
  return parts.join(', ')
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
