import { describe, it, expect, vi, afterEach } from 'vitest'
import { nodeCountsText } from './nodecounts.js'

const SOURCES = [
  { label: 'SF7', url: 'https://x/sf7/count', pick: (j) => j.count },
  { label: 'SF8', url: 'https://x/cs/stats', pick: (j) => j.totalNodes },
]

const okJson = (body) => ({ ok: true, json: async () => body })

afterEach(() => { vi.unstubAllGlobals() })

describe('nodeCountsText', () => {
  it('formats both counts in source order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) =>
      url.includes('sf7') ? okJson({ count: 180 }) : okJson({ totalNodes: 1520 })))
    expect(await nodeCountsText(SOURCES)).toBe('SF7 : 180 nodes | SF8 : 1520 nodes')
  })

  it('omits a source that fails (HTTP error or network)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('sf7')) throw new Error('down')
      return okJson({ totalNodes: 1520 })
    }))
    expect(await nodeCountsText(SOURCES)).toBe('SF8 : 1520 nodes')
  })

  it('omits a source whose response lacks a numeric count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) =>
      url.includes('sf7') ? okJson({ count: 7 }) : okJson({ unexpected: true })))
    expect(await nodeCountsText(SOURCES)).toBe('SF7 : 7 nodes')
  })

  it('returns empty string when everything fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await nodeCountsText(SOURCES)).toBe('')
  })
})
