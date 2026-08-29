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
// The node-position layer (▲ markers) also displays self-reported advertised
// positions, which may be stale; drift from our estimate indicates the
// difference between the node's last report and current radio measurements.
export const SPLASH_DISCLAIMER =
  'Mapping radio signals (RSSI/SNR), not GPS tracking of the target: the map shows where you were when you heard it. Advertised positions are self-reported by the operator and may be stale.'

// Getting-started basics (was #143), shown as a short list in the glass panel.
export const SPLASH_BASICS = [
  'Open in Chrome or Bluefy (iOS)',
  'Pair your companion — tap Connect',
  'Listens only — nothing sent unless you enable Discover',
]

// The FAB stack the onboarding spotlight lifts, rings and points its `fabs`
// callout at, bottom-to-top. One list so the three places that have to agree —
// the callout copy below, positionCallouts()'s union in app.js, and the
// body.onboarding rules in styles/app.css — cannot drift apart again: #316
// found #nodepos-toggle ringed by the CSS but missing from the union, so the
// callout was anchored below a button it was also spotlighting.
export const SPLASH_FAB_IDS = ['layer-toggle', 'discover-btn', 'recenter-btn', 'sound-toggle', 'nodepos-toggle']

// Spotlight callouts (was #119, updated for the #128 topbar). Each points at a
// live control group revealed through the scrim.
export const SPLASH_CALLOUTS = {
  controls: 'Select repeaters or senders and filter for traffic type.',
  menu: 'Settings, connection and your account. Registering makes you a hunter and puts your captures on the shared coverage map.',
  // Listed bottom-to-top, in the order the buttons actually stack.
  fabs: 'View: points/hex/both in 2D and 3D · auto-discover, which pings selected repeaters too · compass mode · sound pings · node positions: ▲ advertised, ● our estimate',
}
