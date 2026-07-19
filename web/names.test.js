import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveName, cachedName, cachedPosition, _resetNameCache } from './names.js'

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
