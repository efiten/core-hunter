import { describe, it, expect } from 'vitest'
import { resolvePrefixResponse, positionsResponse, createServer } from '../http.js'

// Minimal fake store implementing resolvePrefix.
function fakeStore(rows) {
  return { resolvePrefix: (pfx) => rows.filter((r) => r.pubkey.startsWith(pfx)).slice(0, 2) }
}

describe('resolvePrefixResponse', () => {
  const store = fakeStore([
    { pubkey: 'aabbccdd', name: 'One', lat: 1.5, lon: 2.5 },
    { pubkey: 'aabbeeff', name: 'Two', lat: null, lon: null },
  ])

  it('400s on non-hex prefix', () => {
    expect(resolvePrefixResponse(store, 'zz!!').status).toBe(400)
  })
  it('400s on too-short prefix (<4 hex)', () => {
    expect(resolvePrefixResponse(store, 'aa').status).toBe(400)
  })
  it('returns a unique hit with lat/lon', () => {
    const { status, json } = resolvePrefixResponse(store, 'aabbcc')
    expect(status).toBe(200)
    expect(json).toEqual({ prefix: 'aabbcc', pubkey: 'aabbccdd', name: 'One', ambiguous: false, lat: 1.5, lon: 2.5 })
  })
  it('omits lat/lon when null', () => {
    const { json } = resolvePrefixResponse(store, 'aabbee')
    expect(json).toEqual({ prefix: 'aabbee', pubkey: 'aabbeeff', name: 'Two', ambiguous: false })
  })
  it('reports ambiguous when >1 match', () => {
    expect(resolvePrefixResponse(store, 'aabb').json).toEqual({ prefix: 'aabb', ambiguous: true })
  })
  it('reports not-found without pubkey/name', () => {
    expect(resolvePrefixResponse(store, 'ffff').json).toEqual({ prefix: 'ffff', ambiguous: false })
  })
})

describe('positionsResponse', () => {
  it('returns every positioned node in one bulk payload', () => {
    const store = { allWithPosition: () => [
      { pubkey: 'aabbccdd', name: 'One', lat: 51.2, lon: 4.4 },
      { pubkey: 'eeff0011', name: 'Two', lat: 52.1, lon: 5.3 },
    ] }
    const { status, json } = positionsResponse(store)
    expect(status).toBe(200)
    expect(json).toEqual({
      count: 2,
      nodes: [
        { pubkey: 'aabbccdd', name: 'One', lat: 51.2, lon: 4.4 },
        { pubkey: 'eeff0011', name: 'Two', lat: 52.1, lon: 5.3 },
      ],
    })
  })

  it('returns an empty list rather than erroring when nothing is positioned', () => {
    const { status, json } = positionsResponse({ allWithPosition: () => [] })
    expect(status).toBe(200)
    expect(json).toEqual({ count: 0, nodes: [] })
  })
})

describe('createServer', () => {
  it('serves /api/nodes/positions', async () => {
    const store = { ...fakeStore([]), allWithPosition: () => [{ pubkey: 'aabbccdd', name: 'One', lat: 51.2, lon: 4.4 }] }
    const server = createServer(store)
    await new Promise((resolve) => server.listen(0, resolve))
    const port = server.address().port
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/nodes/positions`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ count: 1, nodes: [{ pubkey: 'aabbccdd', name: 'One', lat: 51.2, lon: 4.4 }] })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('serves /api/nodes/count', async () => {
    const store = { ...fakeStore([]), count: () => 42 }
    const server = createServer(store)
    await new Promise((resolve) => server.listen(0, resolve))
    const port = server.address().port
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/nodes/count`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ count: 42 })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('serves /healthz and /api/nodes/resolve', async () => {
    const store = fakeStore([{ pubkey: 'aabbccdd', name: 'One', lat: null, lon: null }])
    const server = createServer(store)
    await new Promise((resolve) => server.listen(0, resolve))
    const port = server.address().port
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`)
      expect(health.status).toBe(200)
      expect(await health.text()).toBe('ok')

      const r = await fetch(`http://127.0.0.1:${port}/api/nodes/resolve?prefix=aabbcc`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ prefix: 'aabbcc', pubkey: 'aabbccdd', name: 'One', ambiguous: false })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
