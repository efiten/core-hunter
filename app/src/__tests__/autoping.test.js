import { describe, it, expect } from 'vitest'
import { shouldAutoFire, INTERVAL_MS, MOVE_THRESHOLD_M, staggerTargets, STAGGER_MS, cycleSpanMs, autoPingCadenceText } from '../autoping.js'

const BASE = { lastFireAt: null, lastLat: null, lastLon: null, now: 0, lat: 51.0, lon: 3.7 }

describe('shouldAutoFire', () => {
  it('fires immediately when it has never fired', () => {
    expect(shouldAutoFire({ ...BASE })).toBe(true)
  })
  it('fires once the interval has elapsed, even without movement', () => {
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: INTERVAL_MS }
    expect(shouldAutoFire(opts)).toBe(true)
  })
  it('does not fire before the interval elapses without enough movement', () => {
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: INTERVAL_MS - 1, lat: 51.0, lon: 3.7 }
    expect(shouldAutoFire(opts)).toBe(false)
  })
  it('fires early once moved past the threshold, before the interval elapses', () => {
    // ~0.00045 deg lat ~= 50m
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: 1000, lat: 51.00045, lon: 3.7 }
    expect(shouldAutoFire(opts)).toBe(true)
  })
  it('does not fire early for movement under the threshold', () => {
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: 1000, lat: 51.00001, lon: 3.7 }
    expect(shouldAutoFire(opts)).toBe(false)
  })
  it('falls back to the interval-only check when no GPS fix is available', () => {
    expect(shouldAutoFire({ ...BASE, lastFireAt: 0, lastLat: null, lastLon: null, now: 500, lat: null, lon: null })).toBe(false)
    expect(shouldAutoFire({ ...BASE, lastFireAt: 0, lastLat: null, lastLon: null, now: INTERVAL_MS, lat: null, lon: null })).toBe(true)
  })
  it('exposes the agreed defaults', () => {
    expect(INTERVAL_MS).toBe(10000)
    expect(MOVE_THRESHOLD_M).toBe(50)
  })
})

describe('staggerTargets', () => {
  // First target starts at STAGGER_MS, not 0 (#253): autoPingTick's discover
  // broadcast fires synchronously right before these on a half-duplex radio,
  // so delayMs 0 would collide with it.
  it('spaces target ids STAGGER_MS apart, preserving order, first after one stagger slot', () => {
    expect(staggerTargets(['aa', 'bb', 'cc'])).toEqual([
      { id: 'aa', delayMs: STAGGER_MS },
      { id: 'bb', delayMs: STAGGER_MS * 2 },
      { id: 'cc', delayMs: STAGGER_MS * 3 },
    ])
  })
  it('returns an empty array for no targets', () => {
    expect(staggerTargets([])).toEqual([])
  })
  it('defaults STAGGER_MS to 1500', () => {
    expect(STAGGER_MS).toBe(1500)
  })
})

// #253/#254: a cycle's trace-pings span targetCount * STAGGER_MS. With enough
// targets that span exceeds INTERVAL_MS, so the next cycle's discover broadcast
// lands between the previous cycle's traces. Two chains then interleave at
// arbitrary phase, which is what pressures the companion's 16-slot send queue —
// and queueOutbound drops silently on overflow. The fire gate must refuse to
// start a cycle while its predecessor is still transmitting.
describe('cycle overlap', () => {
  it('reports the wall-clock span a cycle occupies', () => {
    expect(cycleSpanMs(0)).toBe(0)
    expect(cycleSpanMs(3)).toBe(3 * STAGGER_MS)
  })

  it('a 7-target cycle outlasts the fire interval', () => {
    // 7 * 1500 = 10500 > 10000 — reachable on the stationary interval alone.
    expect(cycleSpanMs(7)).toBeGreaterThan(INTERVAL_MS)
  })

  it('does not fire while the previous cycle still has pending trace-pings', () => {
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: INTERVAL_MS, pendingTargets: 2 }
    expect(shouldAutoFire(opts)).toBe(false)
  })

  it('does not let the movement gate bypass a still-draining cycle', () => {
    // 50m of movement at speed fires early — the exact path that overlaps.
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: 1000, lat: 51.00045, lon: 3.7, pendingTargets: 3 }
    expect(shouldAutoFire(opts)).toBe(false)
  })

  it('fires again once the previous cycle has drained', () => {
    const opts = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, now: INTERVAL_MS, pendingTargets: 0 }
    expect(shouldAutoFire(opts)).toBe(true)
  })

  it('treats an absent pendingTargets as drained, so the gate is opt-in', () => {
    expect(shouldAutoFire({ ...BASE, lastFireAt: 0, now: INTERVAL_MS })).toBe(true)
  })
})

// #381: the distance gate has no lower bound, so at speed a cycle fires as
// fast as 50 m goes by, and the interval alone was already over the transmit
// budget for a multi-frame cycle standing still. minPeriodMs is the airtime
// the previous cycle spent divided by the duty budget (airtime.js), and no
// gate may fire inside it.
describe('duty floor', () => {
  const still = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, lat: 51.0, lon: 3.7 }
  const moved = { ...BASE, lastFireAt: 0, lastLat: 51.0, lastLon: 3.7, lat: 51.00045, lon: 3.7 }

  it('binds at speed with no target: 50 m gone by inside the floor does not fire', () => {
    expect(shouldAutoFire({ ...moved, now: 1000, minPeriodMs: 2420 })).toBe(false)
    expect(shouldAutoFire({ ...moved, now: 2420, minPeriodMs: 2420 })).toBe(true)
  })

  it('binds on target count standing still: the interval elapsing is not enough', () => {
    expect(shouldAutoFire({ ...still, now: INTERVAL_MS, minPeriodMs: 12940 })).toBe(false)
    expect(shouldAutoFire({ ...still, now: 12940, minPeriodMs: 12940 })).toBe(true)
  })

  it('leaves the interval gate alone when the floor is shorter than it', () => {
    expect(shouldAutoFire({ ...still, now: INTERVAL_MS - 1, minPeriodMs: 2420 })).toBe(false)
    expect(shouldAutoFire({ ...still, now: INTERVAL_MS, minPeriodMs: 2420 })).toBe(true)
  })

  it('never delays the first cycle', () => {
    expect(shouldAutoFire({ ...BASE, minPeriodMs: 12940 })).toBe(true)
  })
})

describe('autoPingCadenceText', () => {
  it('says off, or the period the next cycle waits for, in whole seconds rounded up', () => {
    expect(autoPingCadenceText({ enabled: false, minPeriodMs: 12940 })).toBe('Off')
    expect(autoPingCadenceText({ enabled: true, minPeriodMs: 0 })).toBe('On, every 10 s')
    expect(autoPingCadenceText({ enabled: true, minPeriodMs: 12940 })).toBe('On, every 13 s')
  })
})
