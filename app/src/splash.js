// Cold-start splash: shown until the first GPS fix arrives, per AGENTS.md
// (no coverage without a position, so hunting cannot start before that).
// splashState resolves the display state from the connection/GPS status.
export function splashState({ hasFix, connected, bleError, gpsError }) {
  if (hasFix) return 'hidden'
  if (bleError) return 'ble-error'
  if (!connected) return 'intro'
  if (gpsError) return 'gps-error'
  return 'waiting-gps'
}

export const SPLASH_COPY = {
  intro: 'Tap Connect below to start hunting.',
  'waiting-gps': 'Waiting for a GPS fix…',
  'gps-error': 'Could not get your location. Make sure location access is allowed for this site, then retry.',
  'ble-error': 'Could not connect to the hunter. Tap Connect below to retry.',
}

// Pinned above the rotating tips: the AGENTS.md §7 position disclaimer. The
// splash implies locating a transmitter ("walk toward the heat"), so it must
// state that position is inferred from radio measurements, not GPS-tracked.
export const SPLASH_DISCLAIMER =
  'Position is inferred from radio signal (RSSI/SNR) via mesh topology — not GPS tracking of the target. The map shows where you were when you heard it.'

// Rotating hunting tips shown while waiting for a GPS fix, so the wait is spent
// learning how to hunt. Cycled one at a time by app.js via pickTip().
export const SPLASH_TIPS = [
  '“Heat” is signal strength — stronger means closer. Drive toward the hottest points.',
  "Encircle your target. One-sided sampling can't pin it — drive around it and get close.",
  'Pick a specific sender from the target dropdown and the map isolates it.',
  'Right on top of a strong transmitter? Switch on an attenuator (Settings) so the signal picture stays useful up close.',
  'Only directly-heard (zero-hop) packets locate a transmitter — a relayed packet describes the last repeater, not the target.',
  'Receptions are saved on your phone before upload — keep hunting without a network and it syncs later.',
  'Mute known repeaters with the ignore-list, or they form false hotspots.',
]

// pickTip returns the tip at a cyclic index (wraps in both directions), or ''
// for an empty list. Pure so the rotation is unit-testable; app.js holds the
// running index and calls this on a timer.
export function pickTip(tips, i) {
  if (!tips || tips.length === 0) return ''
  const n = tips.length
  return tips[((i % n) + n) % n]
}
