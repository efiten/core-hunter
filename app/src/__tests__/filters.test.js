import { describe, it, expect } from 'vitest'
import { makeFilter, isFilterActive, DEFAULT_FILTER } from '../filters.js'

const rec = (o) => ({ sender_id: '4a', packet_type: 'Response', is_direct: true, hops: 0,
  rx_at: '2026-06-29T10:00:00Z', ...o })
const now = Date.parse('2026-06-29T10:05:00Z')

describe('makeFilter', () => {
  it('isolates a sender by exact id (case-insensitive)', () => {
    const f = makeFilter({ sender: { id: '4A' }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec(), now)).toBe(true)
    expect(f(rec({ sender_id: 'bb' }), now)).toBe(false)
    expect(f(rec({ sender_id: null }), now)).toBe(false)
  })
  it('ignores listed sender ids', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: false, ignore: new Set(['4a']) })
    expect(f(rec(), now)).toBe(false)
    expect(f(rec({ sender_id: 'cc' }), now)).toBe(true)
  })
  it('directOnly keeps only zero-hop receptions — is_direct is also true for relayed FLOOD (#138)', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: true, ignore: null })
    expect(f(rec({ is_direct: true, hops: 2 }), now)).toBe(false)
    expect(f(rec({ is_direct: true, hops: 0 }), now)).toBe(true)
  })
  it('directOnly drops relayed; window drops stale; types filter', () => {
    expect(makeFilter({ sender: null, types: null, windowMs: null, directOnly: true, ignore: null })(rec({ is_direct: false, hops: 1 }), now)).toBe(false)
    expect(makeFilter({ sender: null, types: null, windowMs: 600000, directOnly: false, ignore: null })(rec({ rx_at: '2026-06-29T09:50:00Z' }), now)).toBe(false)
    expect(makeFilter({ sender: null, types: new Set(['Advert']), windowMs: null, directOnly: false, ignore: null })(rec({ packet_type: 'Response' }), now)).toBe(false)
  })
  it('type filter matches decoder packet_type names (GroupText)', () => {
    const f = makeFilter({ sender: null, types: new Set(['GroupText']), windowMs: null, directOnly: false, ignore: null })
    expect(f({ sender_id: 'x', packet_type: 'GroupText', is_direct: true, rx_at: '2026-06-29T10:00:00Z' }, Date.parse('2026-06-29T10:01:00Z'))).toBe(true)
    expect(f({ sender_id: 'x', packet_type: 'Response', is_direct: true, rx_at: '2026-06-29T10:00:00Z' }, Date.parse('2026-06-29T10:01:00Z'))).toBe(false)
  })
})

describe('isFilterActive', () => {
  it('the default filter is not active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER })).toBe(false)
  })
  it('an isolated sender is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, sender: { key: 'aa', keylen: 1 } })).toBe(true)
  })
  it('the default filter has direct-only off', () => {
    expect(DEFAULT_FILTER.directOnly).toBe(false)
  })
  it('the default plot window is 30 minutes', () => {
    expect(DEFAULT_FILTER.windowMs).toBe(1800000)
  })
  it('turning direct-only on is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, directOnly: true })).toBe(true)
  })
  it('a non-default time window is active (including all-time)', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, windowMs: 3600000 })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, windowMs: null })).toBe(true)
  })
  it('a non-empty type set is active; an empty/null set is not', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, types: new Set(['advert']) })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, types: new Set() })).toBe(false)
    expect(isFilterActive({ ...DEFAULT_FILTER, types: null })).toBe(false)
  })
  it('is false for a null/undefined filter', () => {
    expect(isFilterActive(null)).toBe(false)
    expect(isFilterActive(undefined)).toBe(false)
  })
})
