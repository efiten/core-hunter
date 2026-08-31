import { describe, it, expect } from 'vitest'
import { RX_FULL_LANES, RX_COLLAPSE_STOPS, rxLanes, rxPlayhead, rxPadBottom, rxCanCollapse, nextCollapse, collapseLevels, atLastCollapse, tickerState, tickerStored } from '../receptionlog.js'

// The card was ten lanes or nothing: 298px, a third of a 915px phone, whether
// it held one reception or two hundred (#560). A full one did not even show
// ten, because the playhead sat six lanes down with three lanes of padding
// under it, so ten receptions rendered as seven rows over three blank lanes.
//
// The curve below is Kasper's, given 31 August. It is stated here as the table
// he wrote rather than as the thresholds the implementation uses, so the test
// disagrees with a wrong implementation instead of restating it.
describe('rxLanes', () => {
  const CURVE = [
    [0, 0], [1, 1], [2, 1], [3, 3], [4, 3], [5, 3],
    [6, 5], [7, 5], [8, 5], [9, 5], [10, 10], [11, 10],
  ]

  it.each(CURVE)('shows %i receptions in %i lanes', (count, lanes) => {
    expect(rxLanes(count, 0)).toBe(lanes)
  })

  it('stays at the full card however much arrives beyond it', () => {
    for (const count of [12, 40, 200]) expect(rxLanes(count, 0)).toBe(RX_FULL_LANES)
  })

  it('holds at each stop however much has arrived', () => {
    for (const count of [6, 10, 200]) {
      expect(rxLanes(count, 1), `${count} at the first stop`).toBe(RX_COLLAPSE_STOPS[0])
      expect(rxLanes(count, 2), `${count} at the second stop`).toBe(RX_COLLAPSE_STOPS[1])
    }
  })

  // A stop is a ceiling, not a size: with two receptions the card is one lane
  // already, and forcing three would put back the blank lanes the growth
  // exists to remove.
  it('never uses a stop to make the card bigger than its contents', () => {
    for (const count of [0, 1, 2, 3]) {
      expect(rxLanes(count, 1), `${count} receptions`).toBeLessThanOrEqual(rxLanes(count, 0))
    }
    expect(rxLanes(2, 1)).toBe(1)
  })

  it('never shows more lanes than it has receptions to fill them', () => {
    for (const [count, lanes] of CURVE) {
      expect(lanes, `${count} receptions`).toBeLessThanOrEqual(Math.max(count, 0))
    }
  })

  it('is a staircase: more receptions never make the card shorter', () => {
    for (let n = 1; n <= 60; n++) {
      expect(rxLanes(n, 0), `${n} vs ${n - 1}`).toBeGreaterThanOrEqual(rxLanes(n - 1, 0))
    }
  })

  it('treats junk counts as an empty card rather than throwing', () => {
    for (const junk of [null, undefined, NaN, -3, 'four']) {
      expect(rxLanes(junk, 0), String(junk)).toBe(0)
    }
  })

  it('treats a junk collapse level as full', () => {
    for (const junk of [null, undefined, -1, 9, 'three']) {
      expect(rxLanes(50, junk), String(junk)).toBe(RX_FULL_LANES)
    }
  })
})

// "Laatste onderaan", at every size. The old offset is what left blank lanes
// under the newest reception, which is the half of #560 that is not about
// height.
describe('rxPlayhead and rxPadBottom', () => {
  it('puts the newest reception on the bottom lane at every size', () => {
    for (const lanes of [1, 3, 5, RX_FULL_LANES]) {
      expect(rxPlayhead(lanes), `${lanes} lanes`).toBe(lanes - 1)
      expect(rxPadBottom(lanes), `${lanes} lanes, nothing below the newest`).toBe(0)
    }
  })

  // The scroll code drives scrollTop to (count - 1) * lineH and expects the
  // browser to reach it, which holds exactly while the padding either side
  // covers the lanes the box cannot show. This is the invariant tying the
  // three numbers together, and the reason padBottom is derived.
  it('leaves the newest reception reachable at every size', () => {
    for (const lanes of [1, 3, 5, RX_FULL_LANES]) {
      expect(rxPlayhead(lanes) + rxPadBottom(lanes), `${lanes} lanes`).toBe(lanes - 1)
    }
  })

  it('never pads a card past its own height, or below zero', () => {
    for (const lanes of [0, 1, 3, 5, RX_FULL_LANES]) {
      expect(rxPlayhead(lanes)).toBeGreaterThanOrEqual(0)
      expect(rxPlayhead(lanes)).toBeLessThanOrEqual(Math.max(0, lanes - 1))
      expect(rxPadBottom(lanes)).toBeGreaterThanOrEqual(0)
    }
  })
})

// Full, then three lanes, then one, then back to full (Kasper, 31 August).
// The cycle is per reception count, because a stop that is already the card's
// height changes nothing on screen and reads as a dead press. Kasper hit
// exactly that at three receptions: the card is three lanes anyway, so the
// three-lane stop swallowed a tap and "full" was indistinguishable from it.
describe('the collapse cycle', () => {
  it('walks every stop that makes the card smaller, and wraps to full', () => {
    const walk = (count) => {
      const seen = []
      let level = 0
      do { seen.push(rxLanes(count, level)); level = nextCollapse(level, count) } while (level !== 0)
      return seen
    }
    expect(walk(50), 'a full card').toEqual([10, 3, 1])
    expect(walk(6), 'a five-lane card').toEqual([5, 3, 1])
    expect(walk(3), 'a card already at three lanes').toEqual([3, 1])
  })

  it('never offers a stop that leaves the card the same height', () => {
    for (let count = 0; count <= 60; count++) {
      const heights = collapseLevels(count).map((l) => rxLanes(count, l))
      expect(new Set(heights).size, `${count} receptions: ${heights}`).toBe(heights.length)
    }
  })

  it('gets smaller with every tap until it wraps', () => {
    for (const count of [3, 6, 10, 50]) {
      const heights = collapseLevels(count).map((l) => rxLanes(count, l))
      for (let i = 1; i < heights.length; i++) {
        expect(heights[i], `${count} receptions, stop ${i}`).toBeLessThan(heights[i - 1])
      }
    }
  })

  it('falls back to full from a level this count cannot reach', () => {
    // Stored while more had arrived, then the filter narrowed.
    expect(nextCollapse(1, 3)).toBe(0)
    for (const junk of [null, undefined, -1, 9, 'two']) expect(nextCollapse(junk, 50)).toBe(0)
  })

  it('turns the chevron round only on the last stop', () => {
    expect(atLastCollapse(0, 50)).toBe(false)
    expect(atLastCollapse(1, 50)).toBe(false)
    expect(atLastCollapse(2, 50)).toBe(true)
    // At three receptions the three-lane stop is skipped, so level 2 is last.
    expect(atLastCollapse(2, 3)).toBe(true)
    expect(atLastCollapse(0, 3)).toBe(false)
    // Nothing to collapse, so nothing to turn round.
    expect(atLastCollapse(0, 2)).toBe(false)
  })

  // Below the smallest stop the chevron would be a control that does nothing.
  it('offers the control only once a stop would change something', () => {
    expect(rxCanCollapse(0)).toBe(false)
    expect(rxCanCollapse(1)).toBe(false)
    expect(rxCanCollapse(2)).toBe(false)
    expect(rxCanCollapse(3)).toBe(true)
    expect(rxCanCollapse(50)).toBe(true)
  })
})

// One key holds all four states, because they are one question: how much of
// the ticker is on screen. Splitting it into a boolean plus a size would let a
// reload land on "closed and expanded", which is not a state.
describe('tickerState', () => {
  it('opens full for a first visit, or when storage is unreadable', () => {
    expect(tickerState(null)).toEqual({ visible: true, collapse: 0 })
    expect(tickerState(undefined)).toEqual({ visible: true, collapse: 0 })
  })

  it('restores each stored state', () => {
    expect(tickerState('open')).toEqual({ visible: true, collapse: 0 })
    expect(tickerState('collapsed')).toEqual({ visible: true, collapse: 1 })
    expect(tickerState('minimal')).toEqual({ visible: true, collapse: 2 })
    expect(tickerState('closed')).toEqual({ visible: false, collapse: 0 })
  })

  // 'open' and 'closed' are what pre-#560 builds wrote, so every existing
  // install arrives with one of those two and must keep working.
  it('treats an unrecognised value as a first visit', () => {
    expect(tickerState('half')).toEqual({ visible: true, collapse: 0 })
  })

  it('round-trips every state it can produce', () => {
    for (const stored of ['open', 'collapsed', 'minimal', 'closed']) {
      expect(tickerStored(tickerState(stored)), stored).toBe(stored)
    }
  })

  it('has a stored name for every stop the chevron can reach', () => {
    for (let level = 0; level <= RX_COLLAPSE_STOPS.length; level++) {
      expect(tickerStored({ visible: true, collapse: level }), `level ${level}`).toBeTruthy()
      expect(tickerState(tickerStored({ visible: true, collapse: level })).collapse).toBe(level)
    }
  })

  // A closed card has no size on screen, so collapsed must not survive
  // alongside it: otherwise reopening would silently land on three lanes.
  it('writes closed for a hidden card whatever its last size was', () => {
    expect(tickerStored({ visible: false, collapse: 2 })).toBe('closed')
  })
})
