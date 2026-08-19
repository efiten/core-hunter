import { describe, it, expect } from 'vitest'
import {
  positionsUrl, nodesPageUrl, normalizeNodes, morePages,
  REGISTRY_PAGE, MAX_REGISTRY_PAGES,
} from '../noderegistry.js'

describe('registry URLs', () => {
  it('swaps /resolve for the nameresolver bulk route', () => {
    expect(positionsUrl('https://r.example/sf7/api/nodes/resolve'))
      .toBe('https://r.example/sf7/api/nodes/positions')
  })

  it('refuses to guess a bulk route for a URL that is not a /resolve one', () => {
    // A resolver configured as something else is not a registry we know the
    // shape of; inventing a sibling path would fetch a stranger's endpoint.
    expect(positionsUrl('https://r.example/api/nodes')).toBeNull()
    expect(nodesPageUrl('https://r.example/api/nodes')).toBeNull()
    expect(positionsUrl('not a url')).toBeNull()
  })

  it('falls back to the collection the resolve route hangs off', () => {
    expect(nodesPageUrl('https://r.example/cs/api/nodes/resolve'))
      .toBe(`https://r.example/cs/api/nodes?limit=${REGISTRY_PAGE}`)
  })

  it('asks for the next page by offset, keeping any query the config carried', () => {
    const u = new URL(nodesPageUrl('https://r.example/cs/api/nodes/resolve?key=abc', 2 * REGISTRY_PAGE))
    expect(u.searchParams.get('offset')).toBe(String(2 * REGISTRY_PAGE))
    expect(u.searchParams.get('limit')).toBe(String(REGISTRY_PAGE))
    expect(u.searchParams.get('key')).toBe('abc')
  })

  it('leaves offset off the first page', () => {
    expect(nodesPageUrl('https://r.example/cs/api/nodes/resolve', 0)).not.toContain('offset')
  })
})

describe('normalizeNodes', () => {
  it('reads both registry shapes into one row shape', () => {
    // The whole of #418: CoreScope names the key public_key, and that one
    // difference is what kept SF8 off the layer.
    expect(normalizeNodes({ nodes: [{ public_key: 'aa', name: 'CS', lat: 51, lon: 4 }] }))
      .toEqual([{ pubkey: 'aa', name: 'CS', lat: 51, lon: 4 }])
    expect(normalizeNodes({ nodes: [{ pubkey: 'bb', name: 'NR', lat: 52, lon: 5 }] }))
      .toEqual([{ pubkey: 'bb', name: 'NR', lat: 52, lon: 5 }])
  })

  it('drops rows that cannot be plotted, 0,0 among them', () => {
    expect(normalizeNodes({
      nodes: [
        { public_key: 'a', lat: 0, lon: 0 },      // absent position, decoded
        { public_key: 'b', lat: 51 },             // half a position
        { public_key: 'c', lat: null, lon: null },
        { lat: 51, lon: 4 },                      // nothing to attribute it to
        { public_key: 'd', lat: '51', lon: '4' }, // strings are not coordinates
        null,
      ],
    })).toEqual([])
  })

  it('keeps a node at a real 0 latitude', () => {
    // Only the 0,0 pair is the sentinel — the equator is not.
    expect(normalizeNodes({ nodes: [{ public_key: 'e', lat: 0, lon: 4 }] }))
      .toEqual([{ pubkey: 'e', name: '', lat: 0, lon: 4 }])
  })

  it('survives an answer that is not the shape at all', () => {
    for (const j of [null, {}, { nodes: null }, { nodes: 'x' }]) expect(normalizeNodes(j)).toEqual([])
  })
})

describe('morePages', () => {
  it('follows a full page and stops on a short one', () => {
    expect(morePages(REGISTRY_PAGE, 0)).toBe(true)
    expect(morePages(REGISTRY_PAGE - 1, 0)).toBe(false)
    expect(morePages(0, 0)).toBe(false)
  })

  it('stops at the page cap even while pages stay full', () => {
    expect(morePages(REGISTRY_PAGE, MAX_REGISTRY_PAGES - 2)).toBe(true)
    expect(morePages(REGISTRY_PAGE, MAX_REGISTRY_PAGES - 1)).toBe(false)
  })
})
