import { describe, it, expect, vi } from 'vitest'
import { deferWhile } from './deferredredraw.js'

describe('deferWhile — hold a redraw while something is open', () => {
  it('runs immediately when nothing is blocking', () => {
    const fn = vi.fn()
    const d = deferWhile(() => false)
    expect(d.run('points', fn)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('holds the redraw while blocked', () => {
    const fn = vi.fn()
    const d = deferWhile(() => true)
    expect(d.run('points', fn)).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
  it('runs the held redraw on flush', () => {
    const fn = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run('points', fn)
    blocked = false
    expect(d.flush()).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  // Several senders can resolve while one popup is open; the map only needs
  // the last redraw of that kind, not one per resolution.
  it('coalesces within one kind: only the most recent held redraw runs', () => {
    const first = vi.fn(), second = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run('points', first)
    d.run('points', second)
    blocked = false
    d.flush()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
  // ...but different kinds are different updates. Coalescing them would drop
  // one silently: the CS advert and CS relay layers redraw independently, and
  // neither is redrawn by pan or filter changes, so a dropped one stays stale
  // for the rest of the session.
  it('keeps one held redraw per kind', () => {
    const advert = vi.fn(), relay = vi.fn(), points = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run('cs:advert', advert)
    d.run('cs:rxlog', relay)
    d.run('points', points)
    blocked = false
    d.flush()
    expect(advert).toHaveBeenCalledTimes(1)
    expect(relay).toHaveBeenCalledTimes(1)
    expect(points).toHaveBeenCalledTimes(1)
  })
  // Leaflet removes the previous popup before adding the next one, so a
  // popupclose fires while the next popup is already opening. Flushing there
  // would clear the layer out from under the popup that is arriving — the very
  // bug this module exists to prevent, one interaction later.
  it('keeps holding when flush is called while still blocked', () => {
    const fn = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run('points', fn)
    expect(d.flush()).toBe(false)
    expect(fn).not.toHaveBeenCalled()
    blocked = false
    expect(d.flush()).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('flush is a no-op when nothing was held', () => {
    const d = deferWhile(() => false)
    expect(d.flush()).toBe(false)
  })
  it('does not run the same held redraw twice', () => {
    const fn = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run('points', fn)
    blocked = false
    d.flush()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
