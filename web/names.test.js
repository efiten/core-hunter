import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveName, _resetNameCache } from './names.js'

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
