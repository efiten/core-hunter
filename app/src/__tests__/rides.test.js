import { describe, it, expect } from 'vitest'
import { RIDE_GAP_MS, BACKLOG_OUTLINE_ZOOM, splitRides, currentRideStart, isBacklog, showBacklogPoints } from '../rides.js'

const T0 = Date.parse('2026-09-04T13:10:00Z')
const MIN = 60_000
const rec = (msAfter, extra = {}) => ({ rx_at: new Date(T0 + msAfter).toISOString(), ...extra })

describe('splitRides', () => {
  // A ride is a run of receptions with no gap over the threshold between
  // consecutive ones. A gap exactly on the threshold stays one ride: the rule
  // is "more than", so a 10-minute pause is a pause, not a new day.
  it('splits on a gap of more than the threshold, and keeps a gap exactly on it', () => {
    const rows = [rec(0), rec(5 * MIN), rec(15 * MIN), rec(15 * MIN + RIDE_GAP_MS), rec(15 * MIN + RIDE_GAP_MS + 1 + 20 * MIN)]
    const rides = splitRides(rows)
    expect(rides.map((r) => r.length)).toEqual([4, 1])
  })
  it('sorts by rx_at first, so the order the store hands rows in does not matter', () => {
    const rows = [rec(40 * MIN), rec(0), rec(1 * MIN)]
    const rides = splitRides(rows)
    expect(rides.map((r) => r.length)).toEqual([2, 1])
    expect(rides[0][0].rx_at).toBe(rec(0).rx_at)
  })
  it('is one ride for a single reception, and none for nothing', () => {
    expect(splitRides([rec(0)]).map((r) => r.length)).toEqual([1])
    expect(splitRides([])).toEqual([])
    expect(splitRides(undefined)).toEqual([])
  })
  it('leaves out a row whose rx_at does not parse, rather than splitting on it', () => {
    const rows = [rec(0), { rx_at: 'never' }, rec(1 * MIN)]
    expect(splitRides(rows).map((r) => r.length)).toEqual([2])
  })
})

describe('currentRideStart / isBacklog', () => {
  it('is the first reception of the last ride', () => {
    const rows = [rec(0), rec(5 * MIN), rec(60 * MIN), rec(61 * MIN)]
    expect(currentRideStart(rows)).toBe(T0 + 60 * MIN)
  })
  it('is the first reception of the only ride, and null with no receptions', () => {
    expect(currentRideStart([rec(3 * MIN), rec(0)])).toBe(T0)
    expect(currentRideStart([])).toBeNull()
  })
  // Everything before the current ride is backlog; the ride itself, from its
  // first reception on, is not. With no ride known nothing is backlog: the
  // map must never hide points because a computation had nothing to go on.
  it('marks what came before the current ride, and nothing when there is no ride', () => {
    const start = T0 + 60 * MIN
    expect(isBacklog(rec(59 * MIN), start)).toBe(true)
    expect(isBacklog(rec(60 * MIN), start)).toBe(false)
    expect(isBacklog(rec(61 * MIN), start)).toBe(false)
    expect(isBacklog(rec(0), null)).toBe(false)
  })
})

describe('showBacklogPoints', () => {
  // Kasper, 2026-09-04: outlines come back "reasonably soon" while zooming in;
  // zoom 15 is street-grid level, where 8px circles stop overlapping.
  it('draws backlog points from zoom 15, not below', () => {
    expect(BACKLOG_OUTLINE_ZOOM).toBe(15)
    expect(showBacklogPoints(14.9)).toBe(false)
    expect(showBacklogPoints(15)).toBe(true)
    expect(showBacklogPoints(18)).toBe(true)
  })
})
