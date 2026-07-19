import { describe, it, expect, afterEach, vi } from 'vitest'
import { orderResolvers, resolvableKey, isFullPubkey, isResolvableId, cachedName, cachedPosition, resolveName } from '../names.js'
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

const R_SF8 = { label: 'BE', sf: 8, url: 'https://be.example.com/resolve' }
const R_SF7 = { label: 'NL', sf: 7, url: 'https://nl.example.com/resolve' }
const resolvers = [R_SF8, R_SF7]

describe('orderResolvers — pure ordering helper', () => {
  it('puts the matching-SF resolver first when companionSf matches one', () => {
    const ordered = orderResolvers(resolvers, 7)
    expect(ordered[0]).toBe(R_SF7)
    expect(ordered[1]).toBe(R_SF8)
  })

  it('keeps config order when companionSf is undefined (firmware-gated, unknown)', () => {
    const ordered = orderResolvers(resolvers, undefined)
    expect(ordered[0]).toBe(R_SF8)
    expect(ordered[1]).toBe(R_SF7)
  })

  it('keeps config order when companionSf has no matching resolver', () => {
    const ordered = orderResolvers(resolvers, 9)
    expect(ordered[0]).toBe(R_SF8)
    expect(ordered[1]).toBe(R_SF7)
  })

  it('preserves relative order among multiple matching-SF resolvers', () => {
    const r1 = { sf: 7, url: 'https://a.example.com/resolve' }
    const r2 = { sf: 8, url: 'https://b.example.com/resolve' }
    const r3 = { sf: 7, url: 'https://c.example.com/resolve' }
    const ordered = orderResolvers([r1, r2, r3], 7)
    expect(ordered[0]).toBe(r1)
    expect(ordered[1]).toBe(r3)
    expect(ordered[2]).toBe(r2)
  })

  it('returns a new array (does not mutate input)', () => {
    const ordered = orderResolvers(resolvers, 7)
    expect(ordered).not.toBe(resolvers)
    expect(resolvers[0]).toBe(R_SF8) // original unchanged
  })
})

// Registry positions (#197): the resolver already returns lat/lon on a unique
// hit; these cover retaining them instead of discarding them. Each test uses a
// distinct key because the module-level cache persists across tests.
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
