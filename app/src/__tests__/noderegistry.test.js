import { describe, it, expect } from 'vitest'
import {
  positionsUrl, nodesPageUrl, normalizeNodes, morePages, candidateNodes,
  resolversToLoad, mergeRegistryLists, registryLoadPlan, REGISTRY_PAGE, MAX_REGISTRY_PAGES,
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

// #661: the nodes that can be a relay you heard are the ones in the registries
// of the companion's SF (resolversFor, #452). A node on another SF cannot be
// it, so counting it would make a collision out of nothing.
describe('candidateNodes', () => {
  const N1 = { pubkey: '4a4a' + 'aa'.repeat(30), name: 'Zuid', lat: 51, lon: 4 }
  const N2 = { pubkey: '4a4a' + 'bb'.repeat(30), name: 'Noord', lat: 52, lon: 5 }
  const N3 = { pubkey: '4a4a' + 'cc'.repeat(30), name: 'Oost', lat: 51.5, lon: 4.5 }
  const lists = [
    { resolver: { sf: 8, url: 'a' }, nodes: [N1] },
    { resolver: { sf: 11, url: 'b' }, nodes: [N2] },
    { resolver: { sf: 11, url: 'c' }, nodes: [N3] },
  ]
  const keys = (nodes) => nodes.map((n) => n.pubkey).sort()

  it("takes the nodes of the resolvers on the companion's SF", () => {
    expect(keys(candidateNodes(lists, 8))).toEqual([N1.pubkey])
    expect(keys(candidateNodes(lists, 11))).toEqual([N2.pubkey, N3.pubkey].sort())
  })
  it('takes every resolver when the SF is unknown or matches none', () => {
    expect(keys(candidateNodes(lists, null))).toEqual([N1.pubkey, N2.pubkey, N3.pubkey].sort())
    expect(keys(candidateNodes(lists, 9))).toEqual([N1.pubkey, N2.pubkey, N3.pubkey].sort())
  })
  it('counts a resolver of the SF that answered nothing as no nodes, not as a reason to ask the others', () => {
    const down = [{ resolver: { sf: 8, url: 'a' }, nodes: [] }, { resolver: { sf: 11, url: 'b' }, nodes: [N2] }]
    expect(candidateNodes(down, 8)).toEqual([])
  })
})

// #661: a registry is loaded until it has answered, each resolver on its own. A
// load latched on any answer left the companion's SF without candidates for
// the whole session when only a resolver on another SF had answered.
describe('resolversToLoad', () => {
  const A = { sf: 8, url: 'a' }
  const B = { sf: 11, url: 'b' }
  const C = { sf: 11, url: 'c' }
  const N = { pubkey: 'bbbb' + '00'.repeat(30), name: 'Elders', lat: 52, lon: 5 }
  const resolvers = [A, B, C]

  it('loads every resolver before any has answered', () => {
    expect(resolversToLoad(resolvers, [], null)).toEqual([A, B, C])
  })
  it("loads the companion's SF resolver that failed while one on another SF answered", () => {
    const lists = [
      { resolver: A, nodes: [], answered: false },
      { resolver: B, nodes: [N], answered: true },
      { resolver: C, nodes: [], answered: true },
    ]
    expect(resolversToLoad(resolvers, lists, 8)).toEqual([A])
    // The layer draws every SF, so without an SF it loads every one missing.
    expect(resolversToLoad(resolvers, lists, null)).toEqual([A])
  })
  it("leaves a resolver on another SF alone once the companion's SF has answered", () => {
    const lists = [
      { resolver: A, nodes: [], answered: true },
      { resolver: B, nodes: [], answered: false },
      { resolver: C, nodes: [N], answered: true },
    ]
    expect(resolversToLoad(resolvers, lists, 8)).toEqual([])
    expect(resolversToLoad(resolvers, lists, null)).toEqual([B])
  })
  it('loads every resolver missing when the SF matches none, as candidateNodes counts them all', () => {
    const lists = [
      { resolver: A, nodes: [], answered: false },
      { resolver: B, nodes: [N], answered: true },
      { resolver: C, nodes: [], answered: false },
    ]
    expect(resolversToLoad(resolvers, lists, 9)).toEqual([A, C])
  })
  it('counts an answer with no nodes as an answer', () => {
    // An empty registry is a fact (#307), not a failure to ask about again.
    const lists = resolvers.map((resolver) => ({ resolver, nodes: [], answered: true }))
    expect(resolversToLoad(resolvers, lists, 8)).toEqual([])
    expect(resolversToLoad(resolvers, lists, null)).toEqual([])
  })
})

describe('mergeRegistryLists', () => {
  const A = { sf: 8, url: 'a' }
  const B = { sf: 11, url: 'b' }
  const NA = { pubkey: '64aa' + '00'.repeat(30), name: 'Heumensoord-RPT', lat: 51.95, lon: 5.8 }
  const NB = { pubkey: 'bbbb' + '00'.repeat(30), name: 'Elders', lat: 52.3, lon: 4.9 }

  it('takes the first load whole, in its order', () => {
    const fresh = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [NB], answered: true }]
    expect(mergeRegistryLists([], fresh)).toEqual(fresh)
  })
  it('puts a retry that answered in place and keeps the resolver that had answered', () => {
    const prev = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [NB], answered: true }]
    const merged = mergeRegistryLists(prev, [{ resolver: A, nodes: [NA], answered: true }])
    expect(merged).toEqual([{ resolver: A, nodes: [NA], answered: true }, { resolver: B, nodes: [NB], answered: true }])
    expect(candidateNodes(merged, 8)).toEqual([NA])
  })
  it('keeps the nodes of a resolver that answered when a retry of another fails', () => {
    const prev = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [NB], answered: true }]
    const merged = mergeRegistryLists(prev, [{ resolver: A, nodes: [], answered: false }])
    expect(merged).toEqual(prev)
    // The failed SF-8 resolver stays in the lists, so SF 8 counts no nodes
    // instead of falling back to the SF-11 ones.
    expect(candidateNodes(merged, 8)).toEqual([])
  })
})

// #661: every resolver is its own request. A slow resolver on another SF held
// back the nodes of one that had answered, and the connect retry of the
// companion's own SF, until it settled (AGENTS.md §5.4 items 3 and 4).
describe('registryLoadPlan', () => {
  const A = { sf: 8, url: 'a' }
  const B = { sf: 11, url: 'b' }
  const C = { sf: 11, url: 'c' }
  const NA = { pubkey: '64aa' + '00'.repeat(30), name: 'Heumensoord-RPT', lat: 51.95, lon: 5.8 }
  const NB = { pubkey: '64aa' + '11'.repeat(30), name: 'Elders-64', lat: 51.8, lon: 5.95 }
  const resolvers = [A, B, C]

  it('asks every resolver that has not answered when none is out', () => {
    const plan = registryLoadPlan(resolvers, [], [], null)
    expect(plan.ask).toEqual([A, B, C])
    expect(plan.wait).toEqual([])
  })
  it('waits for a resolver already out instead of asking it twice, and asks the rest now', () => {
    const lists = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [], answered: false }]
    const plan = registryLoadPlan(resolvers, lists, [B], null)
    expect(plan.ask).toEqual([A, C])
    expect(plan.wait).toEqual([B])
  })
  it("asks the companion's SF at once while a resolver on another SF is still out, and does not wait for it", () => {
    const lists = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [], answered: false }]
    const plan = registryLoadPlan(resolvers, lists, [B], 8)
    expect(plan.ask).toEqual([A])
    expect(plan.wait).toEqual([])
  })
  it("waits for the companion's SF resolver that is out, then there is nothing else to ask", () => {
    const lists = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [NB], answered: true }]
    const plan = registryLoadPlan(resolvers, lists, [A], 8)
    expect(plan.ask).toEqual([])
    expect(plan.wait).toEqual([A])
  })
  it('neither asks nor waits for a resolver that answered', () => {
    const lists = resolvers.map((resolver) => ({ resolver, nodes: [], answered: true }))
    expect(registryLoadPlan(resolvers, lists, [], null)).toEqual({ ask: [], wait: [], lists })
  })
  it('lists a resolver it asks as not answered, so its SF counts no nodes until it answers', () => {
    // Answers are folded in one resolver at a time. Were a resolver still out
    // missing from the lists, the SF-11 answer landing first would be the only
    // list, and an SF-8 companion would fall back to counting its nodes.
    const plan = registryLoadPlan(resolvers, [], [], null)
    expect(plan.lists).toEqual(resolvers.map((resolver) => ({ resolver, nodes: [], answered: false })))
    const landed = mergeRegistryLists(plan.lists, [{ resolver: B, nodes: [NB], answered: true }])
    expect(candidateNodes(landed, 8)).toEqual([])
    expect(candidateNodes(mergeRegistryLists(landed, [{ resolver: A, nodes: [NA], answered: true }]), 8)).toEqual([NA])
  })
  it('keeps the nodes of a resolver that answered when it lists the ones it asks', () => {
    const lists = [{ resolver: A, nodes: [], answered: false }, { resolver: B, nodes: [NB], answered: true }]
    const plan = registryLoadPlan(resolvers, lists, [], null)
    expect(plan.ask).toEqual([A, C])
    expect(plan.lists).toEqual([
      { resolver: A, nodes: [], answered: false },
      { resolver: B, nodes: [NB], answered: true },
      { resolver: C, nodes: [], answered: false },
    ])
  })
})
