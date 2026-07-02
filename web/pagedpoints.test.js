import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPointsPaged } from './pagedpoints.js'

const okJson = (body) => ({ ok: true, json: async () => body })
const pts = (n, tag) => Array.from({ length: n }, (_, i) => ({ lat: 51, lon: 4, rssi: -80, id: `${tag}${i}` }))

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchPointsPaged', () => {
  it('returns a single page when the server does not truncate', async () => {
    const fetchMock = vi.fn(async () => okJson({ points: pts(3, 'a'), truncated: false }))
    vi.stubGlobal('fetch', fetchMock)
    const { points, capped } = await fetchPointsPaged('sender=ab', { pageSize: 5 })
    expect(points).toHaveLength(3)
    expect(capped).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('limit=5')
    expect(fetchMock.mock.calls[0][0]).toContain('offset=0')
  })

  it('treats a missing truncated field as complete (single page)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ points: [] })))
    const { points, capped } = await fetchPointsPaged('', { pageSize: 5 })
    expect(points).toHaveLength(0)
    expect(capped).toBe(false)
  })

  it('accumulates pages with increasing offsets until not truncated', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ points: pts(5, 'a'), truncated: true }))
      .mockResolvedValueOnce(okJson({ points: pts(5, 'b'), truncated: true }))
      .mockResolvedValueOnce(okJson({ points: pts(2, 'c'), truncated: false }))
    vi.stubGlobal('fetch', fetchMock)
    const { points, capped } = await fetchPointsPaged('sender=ab', { pageSize: 5 })
    expect(points).toHaveLength(12)
    expect(capped).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toContain('offset=5')
    expect(fetchMock.mock.calls[2][0]).toContain('offset=10')
  })

  it('stops at maxTotal and reports capped', async () => {
    const fetchMock = vi.fn(async () => okJson({ points: pts(5, 'x'), truncated: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { points, capped } = await fetchPointsPaged('', { pageSize: 5, maxTotal: 10 })
    expect(points).toHaveLength(10)
    expect(capped).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on an HTTP error so callers keep their existing error handling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await expect(fetchPointsPaged('')).rejects.toThrow('points 500')
  })
})
