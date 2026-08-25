// When a MQTT publisher should exist (#454).
//
// It used to be created in exactly two places: at the end of a successful BLE
// connect, and when un-pausing WHILE BLE was connected. Nothing else ever made
// one, so a session that never got a working broker never got another attempt,
// and un-pausing with the radio disconnected did nothing at all --
// "pauzeren en resume werkt niet", reported from the field on 2026-08-24 after
// two hours of driving of which ten minutes reached the server.
//
// Tying it to BLE was the mistake. Receptions go to IndexedDB first and the
// drain publishes from there, so publishing needs no radio: a hunter who has
// parked with a full queue and unplugged the companion is exactly who most
// needs the backlog to go out. What publishing does need is somewhere to send
// it (a broker in the config), permission (not paused), and an identity for the
// topic and client id (the companion pubkey, which survives a dropped link and
// is only cleared by a deliberate disconnect).

export function mqttShouldRun({ configured = false, paused = false, rxPubkey = '' } = {}) {
  return Boolean(configured) && !paused && Boolean(rxPubkey)
}

// What to do about the gap between what should be running and what is.
//
// `hasClient` is whether a publisher OBJECT exists, not whether its socket is
// up. mqtt.js reconnects a live client on its own every 4 s, so re-creating one
// that is merely offline would throw away its backoff and its inflight queue.
// The case this exists for is the one mqtt.js cannot fix: no client at all.
export function mqttAction(shouldRun, hasClient) {
  if (shouldRun && !hasClient) return 'connect'
  if (!shouldRun && hasClient) return 'end'
  return 'none'
}
