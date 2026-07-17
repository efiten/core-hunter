// Cold-start splash / onboarding overlay: shown until the first GPS fix arrives,
// per AGENTS.md (no coverage without a position, so hunting cannot start before
// that). It doubles as the onboarding surface — a spotlight over the live
// controls plus getting-started basics — and is re-openable via the "?" button.
// splashState resolves the display state from the connection/GPS status.
export function splashState({ hasFix, connected, bleError, gpsError }) {
  if (hasFix) return 'hidden'
  if (bleError) return 'ble-error'
  if (!connected) return 'intro'
  if (gpsError) return 'gps-error'
  return 'waiting-gps'
}

// User-facing product name (internal identifiers stay core-hunter).
export const APP_NAME = 'Mesh-Hunter'

// One-sentence description of what the app does, shown above the
// getting-started basics in the glass panel (#216).
export const SPLASH_TAGLINE =
  'A MeshCore node-hunting toolkit — pair your companion radio, drive around, and every direct reception lands on a live heat-map where hot = strong = close.'

// Status line under the glass panel. `intro` has none — the Connect button is
// the call to action there.
export const SPLASH_COPY = {
  intro: '',
  'waiting-gps': 'Waiting for a GPS fix…',
  'gps-error': 'Could not get your location. Make sure location access is allowed for this site, then tap Retry location.',
  'ble-error': 'Could not connect. Tap Connect to retry.',
}

// Pinned in the glass panel: the AGENTS.md §7 position statement. The splash
// implies locating a transmitter, so it must state we map radio signal, not the
// target's GPS — the map shows where the hunter was when it heard the target.
export const SPLASH_DISCLAIMER =
  'Mapping radio signals (RSSI/SNR), not GPS tracking of the target: the map shows where you were when you heard it.'

// Getting-started basics (was #143), shown as a short list in the glass panel.
export const SPLASH_BASICS = [
  'Open in Chrome or Bluefy (iOS)',
  'Pair your companion — tap Connect',
  'Listens only — nothing sent unless you enable Discover',
]

// Spotlight callouts (was #119, updated for the #128 topbar). Each points at a
// live control group revealed through the scrim.
export const SPLASH_CALLOUTS = {
  controls: 'Select repeaters or senders and filter for traffic type. Use Locate to estimate the origin position.',
  menu: 'Settings and connection. Register your companion to contribute to the shared coverage map.',
  fabs: 'Compass mode · toggle auto-discover — pings selected repeaters too · hex or points · 2D/3D view · sound pings',
}
