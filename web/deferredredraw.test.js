import { describe, it, expect, vi } from 'vitest'
import { deferWhile } from './deferredredraw.js'

describe('deferWhile — hold a redraw while something is open', () => {
  it('runs immediately when nothing is blocking', () => {
    const fn = vi.fn()
    const d = deferWhile(() => false)
    expect(d.run(fn)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('holds the redraw while blocked', () => {
    const fn = vi.fn()
    const d = deferWhile(() => true)
    expect(d.run(fn)).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
  it('runs the held redraw on flush', () => {
    const fn = vi.fn()
    let blocked = true
    const d = deferWhile(() => blocked)
    d.run(fn)
    blocked = false
    expect(d.flush()).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  // Several senders can resolve while one popup is open; the map only needs
  // the last redraw, not one per resolution.
  it('coalesces: only the most recent held redraw runs', () => {
    const first = vi.fn(), second = vi.fn()
    const d = deferWhile(() => true)
    d.run(first)
    d.run(second)
    d.flush()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
  it('flush is a no-op when nothing was held', () => {
    const d = deferWhile(() => false)
    expect(d.flush()).toBe(false)
  })
  it('does not run the same held redraw twice', () => {
    const fn = vi.fn()
    const d = deferWhile(() => true)
    d.run(fn)
    d.flush()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
