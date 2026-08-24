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

  it('signs an empty set, which is a real and common answer', () => {
    // A quiet tick with nothing in the window is a state worth caching, not an
    // absence of one.
    expect(recordsKey([])).toBe('0')
  })

  it('refuses to sign a set it cannot describe', () => {
    // A record with no numeric id contributes nothing to fold, so two different
    // sets of them would sign alike. null is the caller's cue to recompute
    // rather than trust a signature that does not describe the data.
    expect(recordsKey([{ lat: 51, lon: 4 }])).toBeNull()
    expect(recordsKey([{ id: 1 }, { id: null }])).toBeNull()
    expect(recordsKey([{ id: 1 }, { id: 'x' }])).toBeNull()
    expect(recordsKey([{ id: 1 }, null])).toBeNull()
    for (const notAnArray of [null, undefined, 'nope']) expect(recordsKey(notAnArray)).toBeNull()
  })

  it('accepts an id of 0, which is falsy but perfectly real', () => {
    expect(recordsKey([{ id: 0 }, { id: 1 }])).not.toBeNull()
    expect(recordsKey([{ id: 0 }, { id: 1 }])).not.toBe(recordsKey([{ id: 1 }, { id: 0 }]))
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

  it('never reuses an unsignable set, and does not poison the cache with one', () => {
    // Two things at once: a null key always rebuilds, AND it must clear what
    // was stored — otherwise a signable set arriving afterwards could match the
    // entry left behind by a set that was never comparable to it.
    const build = vi.fn((n) => n)
    const c = lastValueCache()
    expect(c.get('k', () => build('first'))).toBe('first')
    expect(c.get(null, () => build('unsignable'))).toBe('unsignable')
    expect(c.get(null, () => build('unsignable-again'))).toBe('unsignable-again')
    expect(c.get('k', () => build('rebuilt'))).toBe('rebuilt')
    expect(build).toHaveBeenCalledTimes(4)
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
