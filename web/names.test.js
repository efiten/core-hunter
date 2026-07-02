import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveName, cachedName } from './names.js'

function jsonResponse(ok, body) {
  return { ok, json: async () => body }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveName (multi-resolver)', () => {
  it('returns the first resolver name on an unambiguous hit and does not call the second', async () => {
    const key = '1111111111111111111111111111111111111111111111111111111111aa'
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(true, { name: 'Alpha', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('Alpha')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls through to the second resolver when the first is ambiguous', async () => {
    const key = '2222222222222222222222222222222222222222222222222222222222bb'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(true, { name: 'Ignored', ambiguous: true }))
      .mockResolvedValueOnce(jsonResponse(true, { name: 'Beta', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('Beta')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls through to the second resolver when the first responds with an HTTP error', async () => {
    const key = '3333333333333333333333333333333333333333333333333333333333cc'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(false, {}))
      .mockResolvedValueOnce(jsonResponse(true, { name: 'Gamma', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('Gamma')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns and caches "" when every resolver responds but none has a name', async () => {
    const key = '4444444444444444444444444444444444444444444444444444444444dd'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(true, { name: '', ambiguous: false }))
      .mockResolvedValueOnce(jsonResponse(true, { name: '', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('')

    const name2 = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name2).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(2) // no additional fetch calls for the second resolveName
  })

  it('returns "" without caching when a resolver throws a network error', async () => {
    const key = '5555555555555555555555555555555555555555555555555555555555ee'
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(true, { name: '', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('')
    expect(cachedName(key)).toBeUndefined()

    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(true, { name: '', ambiguous: false }))
    const name2 = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name2).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(4) // second call retried both resolvers
  })

  it('caches a unique hit so a second call does not re-fetch', async () => {
    const key = '6666666666666666666666666666666666666666666666666666666666ff'
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(true, { name: 'Delta', ambiguous: false }))
    globalThis.fetch = fetchMock
    const name = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name).toBe('Delta')

    const name2 = await resolveName(key, ['https://r1', 'https://r2'])
    expect(name2).toBe('Delta')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
