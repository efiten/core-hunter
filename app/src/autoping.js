import { haversineM } from './geometry.js'

// Auto-ping gate (#233): fires when EITHER the interval has elapsed OR the
// hunter has moved past the threshold since the last fire, whichever comes
// first — a steady baseline cadence while stationary/slow, sped up by
// movement while driving.
//
// Neither gate bounds the rate from below on its own, and a cycle is not one
// frame: it is the Discover plus a trace-ping per target, five frames for a
// standing sweep (#479). So the caller passes minPeriodMs, the airtime the
// previous cycle spent divided by the duty budget (airtime.js: 10% for the
// firmware's default sub-band, per-SF airtime), and no gate fires inside it
// (#381). At SF8 that floor is 12.9 s for a standing sweep of four, above
// the interval, and at speed it is what stops the distance gate from firing
// every 50 m.
export const INTERVAL_MS = 10000
export const MOVE_THRESHOLD_M = 50

export function shouldAutoFire({ lastFireAt, lastLat, lastLon, now, lat, lon, pendingTargets = 0, minPeriodMs = 0, intervalMs = INTERVAL_MS, moveThresholdM = MOVE_THRESHOLD_M }) {
  // A cycle whose predecessor is still transmitting would interleave two chains
  // of trace-pings at arbitrary phase. The companion's send queue is 16 slots
  // and queueOutbound drops silently on overflow, so the overlap costs packets
  // rather than just ordering. Skip this cycle entirely instead of compressing
  // the spacing — the stagger exists to let the queue drain one packet per slot.
  // Reachable two ways: >= 7 targets exceeds INTERVAL_MS on its own
  // (cycleSpanMs), and the movement gate can fire far sooner than that.
  if (pendingTargets > 0) return false
  if (lastFireAt == null) return true
  // The duty floor (#381) sits under both gates: the interval cannot fire
  // before it, and neither can movement.
  if (now - lastFireAt < minPeriodMs) return false
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

// What the Status tab says about the cadence (#381): the period the next
// cycle waits for, which is the interval unless the floor is longer. A
// suppressed cycle is a decision the hunter can read, not a silent cap
// (AGENTS.md §5.4).
export function autoPingCadenceText({ enabled, minPeriodMs = 0, intervalMs = INTERVAL_MS }) {
  if (!enabled) return 'Off'
  return `On, every ${Math.ceil(Math.max(intervalMs, minPeriodMs || 0) / 1000)} s`
}
