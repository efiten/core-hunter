import { describe, it, expect } from 'vitest'
import { windowKey, createWindowCache } from './windowpoints.js'

// #664. A node's estimate is made of every hearing in the time window, so the
// fetch behind it carries no bbox, and a pan or a zoom asks for the very same
// rows again. The key says when two draws want the same rows; the cache hands
// the second one the first one's fetch.

const filters = (over = {}) => ({
  hunter: 'aa,bb', senderPairs: [['sender', 'db11']], from: '2026-09-15T08:00:00Z', to: '',
  types: 'advert', idclass: '', hops: '0', ignorePairs: [['ignores', 'ff00']], ...over,
})

describe('windowKey', () => {
  it('is the same for the same filters, whatever the clock made of a relative range', () => {
    // currentFilters() resolves now-12h against Date.now() on every call, so
    // the resolved `from` differs between two draws a second apart.
    const a = windowKey(filters({ from: '2026-09-15T08:00:00Z' }), { from: 'now-12h', to: 'now' })
    const b = windowKey(filters({ from: '2026-09-15T08:00:01Z' }), { from: 'now-12h', to: 'now' })
    expect(a).toBe(b)
  })

  it('changes with the range the fields hold', () => {
    expect(windowKey(filters(), { from: 'now-12h', to: 'now' }))
      .not.toBe(windowKey(filters(), { from: 'now-24h', to: 'now' }))
  })

  it.each([
    ['hunter', { hunter: 'aa' }],
    ['sender', { senderPairs: [['sender', 'db12']] }],
    ['types', { types: 'advert,trace' }],
    ['idclass', { idclass: 'pubkey' }],
    ['hops', { hops: '' }],
    ['ignore list', { ignorePairs: [] }],
  ])('changes with the %s filter', (_, over) => {
    const raw = { from: 'now-12h', to: 'now' }
    expect(windowKey(filters(over), raw)).not.toBe(windowKey(filters(), raw))
  })
})

describe('createWindowCache', () => {
  const setup = () => {
    let t = 1000
    const loads = []
    const cache = createWindowCache({ maxAgeMs: 10000, now: () => t })
    const load = (value) => () => { loads.push(value); return Promise.resolve(value) }
    return { cache, loads, load, tick: (ms) => { t += ms } }
  }

  it('hands a second draw with the same key the first one\'s fetch', async () => {
    const { cache, loads, load, tick } = setup()
    const first = cache.get('k', load('rows'))
    tick(3000)
    const second = cache.get('k', load('other'))
    expect(await first).toBe('rows')
    expect(await second).toBe('rows')
    expect(loads).toEqual(['rows'])
  })

  it('fetches again when the key changes', async () => {
    const { cache, loads, load } = setup()
    await cache.get('k', load('rows'))
    expect(await cache.get('k2', load('other'))).toBe('other')
    expect(loads).toEqual(['rows', 'other'])
  })

  // One draw with a sender picked wants both: its own rows for the estimates,
  // and the rows without the sender filter for the other repeaters' stars.
  it('keeps two keys side by side, so a draw that wants both fetches each once', async () => {
    const { cache, loads, load, tick } = setup()
    await cache.get('filtered', load('a'))
    await cache.get('unfiltered', load('b'))
    tick(2000)
    expect(await cache.get('filtered', load('a2'))).toBe('a')
    expect(await cache.get('unfiltered', load('b2'))).toBe('b')
    expect(loads).toEqual(['a', 'b'])
  })

  it('fetches again once the rows are older than the live tick', async () => {
    const { cache, loads, load, tick } = setup()
    await cache.get('k', load('rows'))
    tick(10000)
    expect(await cache.get('k', load('newer'))).toBe('newer')
    expect(loads).toEqual(['rows', 'newer'])
  })

  it('joins a fetch that is still out, however old, rather than starting a second', async () => {
    const { cache, loads, tick } = setup()
    let done
    const slow = cache.get('k', () => { loads.push('slow'); return new Promise((res) => { done = res }) })
    tick(30000)
    const again = cache.get('k', () => { loads.push('again'); return Promise.resolve('again') })
    expect(again).toBe(slow)
    done('rows')
    expect(await again).toBe('rows')
    expect(loads).toEqual(['slow'])
  })

  it('does not keep a fetch that failed', async () => {
    const { cache, load } = setup()
    await expect(cache.get('k', () => Promise.reject(new Error('points 500')))).rejects.toThrow('points 500')
    expect(await cache.get('k', load('rows'))).toBe('rows')
  })

})
