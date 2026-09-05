// Cold-start gate (#539): one block guarding the two things a hunt needs —
// the radio and the fix — shown until the first GPS fix arrives, per AGENTS.md
// (no coverage without a position). Connecting is not required: the ✕
// dismisses it for the session (the app holds your own local captures, and
// those are readable without a radio), after which the no-capture banner is
// the one reminder left. The full spotlight tour still exists, but only
// behind the "?" button and About — never on a cold start.
// splashState resolves the display state from the connection/GPS status.
export function splashState({ hasFix, connected, bleError, gpsError, dismissed }) {
  if (hasFix || dismissed) return 'hidden'
  if (bleError) return 'ble-error'
  if (!connected) return 'intro'
  if (gpsError) return 'gps-error'
  return 'waiting-gps'
}

// The two status rows the panel renders per state — the same shape as the
// settings sheet's Connection block, because both guard the same two things.
// Rows are a fixed 38px in CSS, so nothing here may change a row's height:
// the panel hangs from its top and must not jump when a spinner or an SF
// value appears.
export function splashRows(s, { name, sf } = {}) {
  const bluetoothOn = { key: 'Bluetooth', dot: 'on', text: name || 'Connected', extra: sf ? 'SF' + sf : null }
  if (s === 'waiting-gps') return [bluetoothOn, { key: 'GPS', spin: true, text: 'Waiting for a fix…' }]
  if (s === 'gps-error') return [bluetoothOn, { key: 'GPS', dot: 'err', text: 'No fix' }]
  if (s === 'ble-error') {
    return [
      { key: 'Bluetooth', dot: 'err', text: 'Not connected' },
      { key: 'GPS', dot: 'off', text: 'No fix yet' },
    ]
  }
  return [
    { key: 'Bluetooth', dot: 'off', text: 'No companion' },
    { key: 'GPS', dot: 'off', text: 'No fix yet' },
  ]
}

// The banner for whoever dismissed the gate before the first fix (#539
// defect 4): hasFix/gpsError show nowhere else, so without this someone
// drives around while nothing is logged.
export function dismissBanner({ connected } = {}) {
  return connected
    ? 'No GPS fix yet. Nothing is logged without a position.'
    : 'No companion connected. Showing your own captures.'
}

// User-facing product name (internal identifiers stay core-hunter).
export const APP_NAME = 'Mesh-Hunter'

// Fallback lines for the two retryable states. The ble-error line is only
// the fallback: connectFailureMessage (connectstate.js) names the actual
// cause when one was caught.
export const SPLASH_ERRORS = {
  'gps-error': 'Could not get your location. Make sure location access is allowed for this site, then retry.',
  'ble-error': 'Could not connect. Retry to try again.',
}

// Pinned in the glass panel: the AGENTS.md §7 position statement. The splash
// implies locating a transmitter, so it must state we map radio signal, not the
// target's GPS — the map shows where the hunter was when it heard the target.
// The node-position layer (▲ markers) also displays self-reported advertised
// positions, which may be stale; drift from our estimate indicates the
// difference between the node's last report and current radio measurements.
export const SPLASH_DISCLAIMER =
  'Mapping radio signals (RSSI/SNR), not GPS tracking of the target: the map shows where you were when you heard it. Advertised positions are self-reported by the operator and may be stale.'

// The gate's own one-sentence form (#539), allowed since the #413 amendment:
// shown when position output is switched on and reachable afterwards, not
// permanent — and the gate shows no position output itself. Injected as HTML
// (the emphasis on "you" is the sentence's whole point), so it must never
// carry user data.
export const SPLASH_DISCLAIMER_SHORT =
  'Listens only. The map shows where <em>you</em> were when you heard a node, not where it is.'

// The three coach marks beside their own controls (#539, the app half of
// #384): a thin leader line to a small ring on the target — the target is
// pointed at, not touched, so the boxes have air. Injected as innerHTML
// (static copy only). The register mark is the important one: without an
// account your work lands nowhere you can see it. The filters mark is a
// reassurance, not a signpost.
export const COACH_MARKS = [
  { id: 'cm-controls', anchor: 'filter-pill', align: 'left',
    html: '<b>Filters</b> change what you see. Everything is recorded either way.' },
  { id: 'cm-menu', anchor: 'settings-btn', align: 'right',
    html: '<b>Register in Settings</b>, then find your packets on the desktop analyser map.' },
  // side 'left': beside the rail rather than under it — the bottom FAB sits
  // ~590px down on a 667 screen, so a box below it would run off-screen into
  // the HUD. The line runs horizontally to a ring on the FAB's edge.
  { id: 'cm-fabs', anchor: 'layer-toggle', side: 'left',
    html: '<b>Map controls:</b> node locations, auto-ping (zero-hop), 2D/3D, drive mode, sound modes, terrain.' },
]

// The FAB stack the onboarding spotlight lifts, rings and points its `fabs`
// callout at, bottom-to-top. One list so the three places that have to agree —
// the callout copy below, positionCallouts()'s union in app.js, and the
// body.onboarding rules in styles/app.css — cannot drift apart again: #316
// found #nodepos-toggle ringed by the CSS but missing from the union, so the
// callout was anchored below a button it was also spotlighting.
export const SPLASH_FAB_IDS = ['layer-toggle', 'discover-btn', 'recenter-btn', 'sound-toggle', 'nodepos-toggle', 'terrain-btn']

// Spotlight callouts (was #119, updated for the #128 topbar). Each points at a
// live control group revealed through the scrim.
export const SPLASH_CALLOUTS = {
  controls: 'Select repeaters or senders and filter for traffic type.',
  menu: 'Settings, connection and your account. Registering makes you a hunter and puts your captures on the shared coverage map.',
  // Listed bottom-to-top, in the order the buttons actually stack.
  fabs: 'View: points/hex/both in 2D and 3D · auto-discover, which pings selected repeaters too · compass mode · sound pings · node positions: ▲ advertised, ● our estimate · terrain: shaded relief, raised in 3D',
}
