import { haversineM } from './geometry.js'

// Auto-ping gate (#233): fires when EITHER the interval has elapsed OR the
// hunter has moved past the threshold since the last fire, whichever comes
// first — a steady baseline cadence while stationary/slow, sped up by
// movement while driving. Defaults picked from a duty-cycle estimate at SF7
// (~46ms airtime per ~13-byte frame): 10s alone is ~0.46% duty cycle for
// this feature, comfortable headroom below a 1% sub-band with no other
// traffic on the hunter's own radio.
export const INTERVAL_MS = 10000
export const MOVE_THRESHOLD_M = 50

export function shouldAutoFire({ lastFireAt, lastLat, lastLon, now, lat, lon, pendingTargets = 0, intervalMs = INTERVAL_MS, moveThresholdM = MOVE_THRESHOLD_M }) {
  // A cycle whose predecessor is still transmitting would interleave two chains
  // of trace-pings at arbitrary phase. The companion's send queue is 16 slots
  // and queueOutbound drops silently on overflow, so the overlap costs packets
  // rather than just ordering. Skip this cycle entirely instead of compressing
  // the spacing — the stagger exists to let the queue drain one packet per slot.
  // Reachable two ways: >= 7 targets exceeds INTERVAL_MS on its own
  // (cycleSpanMs), and the movement gate can fire far sooner than that.
  if (pendingTargets > 0) return false
  if (lastFireAt == null) return true
  if (now - lastFireAt >= intervalMs) return true
  if (lat == null || lon == null || lastLat == null || lastLon == null) return false
  return haversineM({ lat: lastLat, lon: lastLon }, { lat, lon }) >= moveThresholdM
}

// Target repeater trace-pings are spaced so the radio's send queue drains one
// packet per slot, allowing the discover result to return before the first
// trace-ping. The firmware already ensures one transmission at a time and gives
// the discover broadcast priority, so collision isn't reachable — the stagger
// is for proper ordering and queue management.
export const STAGGER_MS = 1500

export function staggerTargets(ids) {
  return (ids || []).map((id, i) => ({ id, delayMs: (i + 1) * STAGGER_MS }))
}

// Wall-clock span a cycle of N staggered trace-pings occupies, measured from
// the discover broadcast at t=0 to the last trace-ping. Once this exceeds
// INTERVAL_MS the next cycle would start mid-drain — see shouldAutoFire's
// pendingTargets gate, which is what actually prevents the overlap.
export function cycleSpanMs(targetCount, staggerMs = STAGGER_MS) {
  return targetCount > 0 ? targetCount * staggerMs : 0
}
