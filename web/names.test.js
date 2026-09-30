import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveName, cachedName, cachedPosition, _resetNameCache, senderName } from './names.js'

beforeEach(() => { if (_resetNameCache) _resetNameCache() })

describe('resolveName via /api/resolve', () => {
  it('returns the resolved name and ignores missing lat/lon', async () => {
    global.fetch = vi.fn(async (url) => {
      expect(url).toContain('/api/resolve?prefix=abcd')
      return { ok: true, json: async () => ({ prefix: 'abcd', name: 'Repeater-X', ambiguous: false }) }
    })
    expect(await resolveName('abcd')).toBe('Repeater-X')
  })

  it('returns null on ambiguous', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ prefix: 'ab', ambiguous: true }) }))
    expect(await resolveName('ab')).toBeNull()
  })
})

// Registry positions (#197). The resolve proxy strips lat/lon below the member
// role server-side (httpapi/resolve.go), so a guest legitimately gets none.
describe('cachedPosition', () => {
  it('is undefined before a key has been resolved', () => {
    expect(cachedPosition('c0ffee')).toBeUndefined()
  })

  it('retains lat/lon from a unique hit', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ prefix: 'abcd', name: 'Repeater-X', ambiguous: false, lat: 51.2, lon: 4.4 }) }))
    await resolveName('abcd')
    expect(cachedPosition('abcd')).toEqual({ lat: 51.2, lon: 4.4 })
    expect(cachedName('abcd')).toBe('Repeater-X')
  })

  it('caches null when the response carries no position (e.g. a guest)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ prefix: 'abcd', name: 'Repeater-X', ambiguous: false }) }))
    await resolveName('abcd')
    expect(cachedPosition('abcd')).toBeNull()
  })

  it('treats a half-position as no position', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ prefix: 'abcd', name: 'Half', ambiguous: false, lat: 51.2 }) }))
    await resolveName('abcd')
    expect(cachedPosition('abcd')).toBeNull()
  })
})

// #663: a name the resolver cache fills in reads by the same rule as a label
// the server sent.
describe('senderName (#663)', () => {
  beforeEach(() => { _resetNameCache() })
  const answer = (name) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ name }) })))
  it('marks a cached name on a 2-byte relay id as a guess', async () => {
    answer('repeater-3')
    await resolveName('a1b2')
    expect(senderName({ sender_kind: 'relay', sender_id: 'a1b2', sender_label: '' })).toBe('~repeater-3')
  })
  it('leaves a cached name on a full key unmarked', async () => {
    answer('Node Zuid')
    const key = 'ab'.repeat(32)
    await resolveName(key)
    expect(senderName({ sender_kind: 'advert_pubkey', sender_id: key, sender_label: '' })).toBe('Node Zuid')
  })
  it('drops a cached name when the attribution refuses one', async () => {
    answer('repeater-3')
    await resolveName('a1b2')
    expect(senderName({ sender_kind: 'relay', sender_id: 'a1b2', sender_label: '', _attr: { rule: 'collision', count: 2 } })).toBe('a1b2')
  })
  it('prints a 1-byte id as # and its id, never as a name', () => {
    expect(senderName({ sender_kind: 'path_hash', sender_id: '77', sender_label: '77' })).toBe('#77')
  })
  it('falls back to the id, then to a dash', () => {
    expect(senderName({ sender_kind: 'relay', sender_id: 'a1b2f3c4d5e6', sender_label: '' })).toBe('a1b2f3c4d5e6')
    expect(senderName({ sender_kind: 'relay', sender_id: '', sender_label: '' })).toBe('—')
  })
})
