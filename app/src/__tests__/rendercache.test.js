import { describe, it, expect, vi } from 'vitest'
import { recordsKey, lastValueCache } from '../rendercache.js'

const rec = (id) => ({ id, lat: 51, lon: 4, rssi: -70 })

describe('recordsKey', () => {
  it('is stable across the fresh arrays every tick produces', () => {
    // The whole reason this is not a reference check: drawOnce() filters into a
    // new array each second, so identical content arrives as a different object.
    expect(recordsKey([rec(1), rec(2), rec(3)])).toBe(recordsKey([rec(1), rec(2), rec(3)]))
  })

  it('changes when a row arrives', () => {
    expect(recordsKey([rec(1), rec(2)])).not.toBe(recordsKey([rec(1), rec(2), rec(3)]))
  })

  it('changes when one row ages out as another arrives', () => {
    // The case length alone cannot see, and the reason the ids are folded in:
    // the window slides, so this happens on any busy tick.
    expect(recordsKey([rec(1), rec(2), rec(3)])).not.toBe(recordsKey([rec(2), rec(3), rec(4)]))
  })

  it('changes when a row in the middle is swapped out', () => {
    // Same length, same endpoints — an ignore-list toggle can do this.
    expect(recordsKey([rec(1), rec(5), rec(9)])).not.toBe(recordsKey([rec(1), rec(6), rec(9)]))
  })

  it('distinguishes order, since the collapse depends on it', () => {
    expect(recordsKey([rec(1), rec(2)])).not.toBe(recordsKey([rec(2), rec(1)]))
  })

  it('answers for the degenerate inputs draw() can hand it', () => {
    for (const empty of [[], null, undefined, 'nope']) expect(recordsKey(empty)).toBe('0')
    expect(() => recordsKey([null, undefined, {}])).not.toThrow()
  })
})

describe('lastValueCache', () => {
  it('builds once and reuses while the key holds', () => {
    const build = vi.fn(() => ({ big: true }))
    const c = lastValueCache()
    const first = c.get('k', build)
    expect(c.get('k', build)).toBe(first)
    expect(c.get('k', build)).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when the key changes, and again when it changes back', () => {
    // No memory beyond the last answer: coming back to a previous key must not
    // return a stale value from before, it must rebuild.
    const build = vi.fn((n) => n)
    const c = lastValueCache()
    expect(c.get('a', () => build('A'))).toBe('A')
    expect(c.get('b', () => build('B'))).toBe('B')
    expect(c.get('a', () => build('A2'))).toBe('A2')
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('caches a falsy result rather than rebuilding it every time', () => {
    // An empty set is a legitimate answer and the commonest one on a quiet
    // tick; a truthiness check for "have I got one" would rebuild it forever.
    const build = vi.fn(() => 0)
    const c = lastValueCache()
    c.get('k', build)
    c.get('k', build)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('rebuilds after clear()', () => {
    const build = vi.fn(() => 1)
    const c = lastValueCache()
    c.get('k', build)
    c.clear()
    c.get('k', build)
    expect(build).toHaveBeenCalledTimes(2)
  })
})
