// Rides (#556): what "old" means on the map.
//
// The map renders a live reception and the stored backlog the same way, so
// what lands right now, the thing you steer on, is indistinguishable from
// what already stood there. Age fade encodes age, not arrival. The line
// Kasper drew (2026-09-04) is the ride: a gap of more than RIDE_GAP_MS between
// consecutive receptions ends one and starts the next. Everything before the
// current ride is backlog, whatever the time window says; a hunt that keeps
// going across an app restart stays one ride.
//
// Pure, so huntmap.js can ask "is this record backlog" per feature and the
// rule is tested here rather than read off the map.

export const RIDE_GAP_MS = 10 * 60 * 1000

// Below this zoom a backlog reception is coverage only (its hex cell); from
// it, the backlog comes back as outline circles. Kasper: "redelijk snel al".
export const BACKLOG_OUTLINE_ZOOM = 15

const rxMs = (r) => {
  const t = r && r.rx_at != null ? Date.parse(r.rx_at) : NaN
  return Number.isNaN(t) ? null : t
}

// splitRides returns the receptions grouped into rides, each ride sorted by
// rx_at ascending, rides in time order. A gap exactly on the threshold does
// not split: the rule is "more than", so a 10-minute pause is a pause.
export function splitRides(records, gapMs = RIDE_GAP_MS) {
  const rows = (records || []).map((r) => ({ r, t: rxMs(r) })).filter((x) => x.t != null).sort((a, b) => a.t - b.t)
  const rides = []
  let cur = null, last = null
  for (const { r, t } of rows) {
    if (cur == null || t - last > gapMs) { cur = []; rides.push(cur) }
    cur.push(r)
    last = t
  }
  return rides
}

// currentRideStart is the rx_at (epoch ms) of the first reception of the last
// ride, or null when there are no receptions to split.
export function currentRideStart(records, gapMs = RIDE_GAP_MS) {
  const rides = splitRides(records, gapMs)
  if (!rides.length) return null
  return rxMs(rides[rides.length - 1][0])
}

// isBacklog: did this reception come before the current ride? With no ride
// known, nothing is backlog: the map must never hide points because the
// computation had nothing to go on.
export function isBacklog(rec, rideStartMs) {
  if (rideStartMs == null) return false
  const t = rxMs(rec)
  return t != null && t < rideStartMs
}

export function showBacklogPoints(zoom) {
  return Number(zoom) >= BACKLOG_OUTLINE_ZOOM
}
