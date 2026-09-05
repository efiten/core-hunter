import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolversFor, consensusName, isGuessedName, displayName, GUESS_MARK, resolvableKey, isFullPubkey, isResolvableId, cachedName, cachedPosition, resolveName } from '../names.js'
import { setConfig } from '../config.js'

const PUBKEY = 'ab'.repeat(32) // 64 hex chars

describe('resolvableKey — which senders to look up', () => {
  it('returns the lowercased pubkey for a full-id sender with no label', () => {
    expect(resolvableKey({ sender_id: PUBKEY.toUpperCase(), sender_label: '' })).toBe(PUBKEY)
  })
  it('returns the lowercased 2-byte relay path-prefix (CoreScope resolves these)', () => {
    expect(resolvableKey({ sender_id: '1403', sender_label: '' })).toBe('1403')
    expect(resolvableKey({ sender_id: 'AB12', sender_label: '' })).toBe('ab12')
  })
  it('returns the lowercased multi-byte discover prefix', () => {
    expect(resolvableKey({ sender_id: '7B0E24700E0C0D3E', sender_label: '' })).toBe('7b0e24700e0c0d3e')
  })
  it('returns null when a name is already present (fill-only)', () => {
    expect(resolvableKey({ sender_id: PUBKEY, sender_label: 'Repeater-1' })).toBeNull()
    expect(resolvableKey({ sender_id: '1403', sender_label: 'BE-ZOD-MOSKEE-DIS' })).toBeNull()
  })
  it('returns null for a 1-byte source hash (2 hex — ambiguous, not resolvable)', () => {
    expect(resolvableKey({ sender_id: '4a', sender_label: '' })).toBeNull()
  })
  it('returns null when there is no sender_id', () => {
    expect(resolvableKey({ sender_id: '', sender_label: '' })).toBeNull()
    expect(resolvableKey(null)).toBeNull()
  })
})

describe('isResolvableId', () => {
  it('accepts 2..32-byte hex (4..64 chars), rejects 1-byte and garbage', () => {
    expect(isResolvableId('1403')).toBe(true)          // 2-byte relay prefix
    expect(isResolvableId(PUBKEY)).toBe(true)          // full pubkey
    expect(isResolvableId('4a')).toBe(false)           // 1-byte hash — ambiguous
    expect(isResolvableId('xyz')).toBe(false)
    expect(isResolvableId(undefined)).toBe(false)
  })
})

describe('isFullPubkey', () => {
  it('accepts 64 hex chars, rejects short/garbage', () => {
    expect(isFullPubkey(PUBKEY)).toBe(true)
    expect(isFullPubkey('4a')).toBe(false)
    expect(isFullPubkey('xyz')).toBe(false)
    expect(isFullPubkey(undefined)).toBe(false)
  })
})

describe('cachedName', () => {
  it('returns undefined for a key never resolved', () => {
    expect(cachedName('deadbeef')).toBeUndefined()
  })
})

// #452: a registry's ambiguous=false is a per-registry claim, so one hit is
// not enough for a prefix. Every registry of the companion's SF is asked; a
// registry of another SF names nodes you cannot hear, so it is left out
// unless the SF is unknown (Kasper, 2026-09-05).
describe('resolversFor', () => {
  const nl = { label: 'NL', sf: 7, url: 'https://nl.example/resolve' }
  const be = { label: 'BE', sf: 8, url: 'https://be.example/resolve' }
  const nl2 = { label: 'NL2', sf: 7, url: 'https://nl2.example/resolve' }
  it('keeps every resolver of the companion SF, in config order', () => {
    expect(resolversFor([be, nl, nl2], 7)).toEqual([nl, nl2])
  })
  it('asks all of them when the SF is unknown or matches none', () => {
    expect(resolversFor([be, nl], undefined)).toEqual([be, nl])
    expect(resolversFor([be, nl], 9)).toEqual([be, nl])
  })
  it('returns a new array', () => {
    const list = [nl]
    expect(resolversFor(list, 7)).not.toBe(list)
  })
})

// The names the registries answered, reduced to one or none: unanimity is a
// name, silence is no name, and disagreement is a refusal, which is evidence
// against, exactly as mergePrefixGroups treats it (feed.js).
describe('consensusName', () => {
  it('takes the one name every answering registry agrees on', () => {
    expect(consensusName(['Repeater-Zuid'])).toEqual({ name: 'Repeater-Zuid', refused: false })
    expect(consensusName(['Repeater-Zuid', 'Repeater-Zuid'])).toEqual({ name: 'Repeater-Zuid', refused: false })
  })
  it('refuses two different names for one prefix', () => {
    expect(consensusName(['Repeater-Zuid', 'repeater_3_'])).toEqual({ name: '', refused: true })
  })
  it('is no name when nobody answered', () => {
    expect(consensusName([])).toEqual({ name: '', refused: false })
  })
})

describe('resolveName asks every resolver of the SF and refuses disagreement (#452)', () => {
  const NL = { label: 'NL', sf: 7, url: 'https://nl.example/resolve' }
  const NL2 = { label: 'NL2', sf: 7, url: 'https://nl2.example/resolve' }
  const BE = { label: 'BE', sf: 8, url: 'https://be.example/resolve' }
  let calls
  beforeEach(() => { calls = [] })
  afterEach(() => { vi.unstubAllGlobals(); setConfig(null) })
  const answers = (byHost) => vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url))
    const host = new URL(url).host
    const j = byHost[host]
    if (j === 'down') throw new Error('offline')
    return { ok: true, json: async () => j }
  }))

  it('never shows one of two names two registries give the same prefix, and remembers the refusal', async () => {
    setConfig({ resolvers: [NL, NL2] })
    answers({ 'nl.example': { name: 'Repeater-Zuid', ambiguous: false }, 'nl2.example': { name: 'repeater_3_', ambiguous: false } })
    expect(await resolveName('2beb', 7)).toBe('')
    expect(cachedName('2beb')).toBe('')
    expect(calls).toHaveLength(2)
    await resolveName('2beb', 7)
    expect(calls).toHaveLength(2)
  })
  it('names a prefix the registries agree on, and one only one of them knows', async () => {
    setConfig({ resolvers: [NL, NL2] })
    answers({ 'nl.example': { name: 'Repeater-Zuid', ambiguous: false, lat: 51.2, lon: 4.4 }, 'nl2.example': { name: 'Repeater-Zuid', ambiguous: false } })
    expect(await resolveName('2bec', 7)).toBe('Repeater-Zuid')
    expect(cachedPosition('2bec')).toEqual({ lat: 51.2, lon: 4.4 })
    answers({ 'nl.example': { ambiguous: true }, 'nl2.example': { name: 'Only-Here', ambiguous: false } })
    expect(await resolveName('2bed', 7)).toBe('Only-Here')
  })
  it('asks only the resolvers of the companion SF, and asks them all at once', async () => {
    setConfig({ resolvers: [BE, NL, NL2] })
    answers({ 'be.example': { name: 'Wrong-Mesh', ambiguous: false }, 'nl.example': { ambiguous: true }, 'nl2.example': { ambiguous: true } })
    expect(await resolveName('2bee', 7)).toBe('')
    expect(calls.map((u) => new URL(u).host).sort()).toEqual(['nl.example', 'nl2.example'])
  })
  it('keeps a refusal even while a third registry was unreachable: no retry can turn disagreement into a name', async () => {
    const NL3 = { label: 'NL3', sf: 7, url: 'https://nl3.example/resolve' }
    setConfig({ resolvers: [NL, NL2, NL3] })
    answers({ 'nl.example': { name: 'Repeater-Zuid', ambiguous: false }, 'nl2.example': { name: 'repeater_3_', ambiguous: false }, 'nl3.example': 'down' })
    expect(await resolveName('2bea', 7)).toBe('')
    expect(cachedName('2bea')).toBe('')
  })
  it('does not cache silence while a registry was unreachable', async () => {
    setConfig({ resolvers: [NL, NL2] })
    answers({ 'nl.example': 'down', 'nl2.example': { ambiguous: true } })
    expect(await resolveName('2bef', 7)).toBe('')
    expect(cachedName('2bef')).toBeUndefined()
  })
})

// A name resolved for a short prefix is a guess about who was heard: two
// bytes is one in 65,536 per registry, and the hash is the forwarder's, not
// a node id. It keeps its name (Kasper, 2026-09-05) and wears a mark, so no
// surface presents it as a resolved identity. An advert's own name on its
// full key, a channel sender and an 8-byte discover prefix are not guesses.
describe('guessed names', () => {
  it('marks a resolved name on a 2- or 3-byte id', () => {
    expect(isGuessedName({ sender_kind: 'relay', sender_id: '2beb', sender_label: 'repeater_3_' })).toBe(true)
    expect(isGuessedName({ sender_kind: 'relay', sender_id: '2beb01', sender_label: 'repeater_3_' })).toBe(true)
    expect(displayName({ sender_kind: 'relay', sender_id: '2beb', sender_label: 'repeater_3_' })).toBe(GUESS_MARK + 'repeater_3_')
  })
  it('leaves a full pubkey, an 8-byte prefix and a channel sender unmarked', () => {
    expect(isGuessedName({ sender_kind: 'advert_pubkey', sender_id: PUBKEY, sender_label: 'alpha' })).toBe(false)
    expect(isGuessedName({ sender_kind: 'discover_pubkey', sender_id: '7b0e24700e0c0d3e', sender_label: 'alpha' })).toBe(false)
    expect(isGuessedName({ sender_kind: 'channel_name', sender_id: 'Kasper', sender_label: 'Kasper' })).toBe(false)
    expect(displayName({ sender_kind: 'advert_pubkey', sender_id: PUBKEY, sender_label: 'alpha' })).toBe('alpha')
  })
  it('has nothing to mark without a name, and never marks a hash id', () => {
    expect(isGuessedName({ sender_kind: 'relay', sender_id: '2beb', sender_label: '' })).toBe(false)
    expect(isGuessedName({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' })).toBe(false)
    expect(displayName({ sender_kind: 'relay', sender_id: '2beb', sender_label: null })).toBe('')
  })
})

describe('cachedPosition — registry positions retained from a resolve', () => {
  const RESOLVER = { sf: 7, url: 'https://r.example.com/resolve' }
  afterEach(() => { vi.unstubAllGlobals(); setConfig(null) })

  const stubFetch = (json) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => json })))

  it('is undefined for a key that has not been resolved', () => {
    expect(cachedPosition('c0ffee01')).toBeUndefined()
  })

  it('retains lat/lon from a unique hit, alongside the name', async () => {
    setConfig({ resolvers: [RESOLVER] })
    stubFetch({ prefix: 'c0ffee02', pubkey: 'c0ffee02', name: 'Repeater-Zuid', ambiguous: false, lat: 51.2, lon: 4.4 })
    expect(await resolveName('c0ffee02')).toBe('Repeater-Zuid')
    expect(cachedPosition('c0ffee02')).toEqual({ lat: 51.2, lon: 4.4 })
    expect(cachedName('c0ffee02')).toBe('Repeater-Zuid')
  })

  it('caches null when the hit carries no position', async () => {
    setConfig({ resolvers: [RESOLVER] })
    stubFetch({ prefix: 'c0ffee03', pubkey: 'c0ffee03', name: 'No-Position', ambiguous: false })
    expect(await resolveName('c0ffee03')).toBe('No-Position')
    expect(cachedPosition('c0ffee03')).toBeNull()
  })

  it('caches null position for an ambiguous prefix', async () => {
    setConfig({ resolvers: [RESOLVER] })
    stubFetch({ prefix: 'c0ffee04', ambiguous: true })
    expect(await resolveName('c0ffee04')).toBe('')
    expect(cachedPosition('c0ffee04')).toBeNull()
  })

  it('treats a partial position (lat only) as no position', async () => {
    setConfig({ resolvers: [RESOLVER] })
    stubFetch({ prefix: 'c0ffee05', pubkey: 'c0ffee05', name: 'Half', ambiguous: false, lat: 51.2 })
    await resolveName('c0ffee05')
    expect(cachedPosition('c0ffee05')).toBeNull()
  })
})

// #230: drawOnce enriches two overlapping row sets per tick (the window rows
// and the recent rows), so the same unresolved id is looked up twice in the
// same tick. resolveName only consults the cache, and the cache is written
// AFTER the fetch resolves — so both calls miss and both go to the network,
// once per second, for every id that has no name yet. AGENTS.md is explicit
// that name resolution is cached per pubkey and the frontend does not make
// per-item API calls, so in-flight requests have to coalesce too.
describe('resolveName coalesces concurrent lookups (#230)', () => {
  const KEY = 'cd'.repeat(32)
  let calls
  let originalFetch

  beforeEach(() => {
    calls = []
    originalFetch = globalThis.fetch
    setConfig({ resolvers: [{ url: 'https://resolver.test/api', sf: 7 }] })
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    setConfig(null)
  })

  it('issues one request when the same key is asked for twice before it resolves', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    globalThis.fetch = (url) => {
      calls.push(url)
      return gate.then(() => ({ ok: true, json: async () => ({ name: 'Repeater-Zuid', ambiguous: false }) }))
    }
    const both = Promise.all([resolveName(KEY), resolveName(KEY)])
    release()
    const [a, b] = await both
    expect(calls).toHaveLength(1)
    expect(a).toBe('Repeater-Zuid')
    expect(b).toBe('Repeater-Zuid')
  })

  it('still issues separate requests for different keys', async () => {
    globalThis.fetch = (url) => {
      calls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ name: 'X', ambiguous: false }) })
    }
    await Promise.all([resolveName('aa'.repeat(32)), resolveName('bb'.repeat(32))])
    expect(calls).toHaveLength(2)
  })

  it('does not wedge a key after a failed lookup — the next tick may retry', async () => {
    // Own key: the module-level cache persists across tests by design.
    const KEY2 = 'ef'.repeat(32)
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    await resolveName(KEY2)
    globalThis.fetch = (url) => {
      calls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ name: 'Later', ambiguous: false }) })
    }
    expect(await resolveName(KEY2)).toBe('Later')
    expect(calls).toHaveLength(1)
  })
})
