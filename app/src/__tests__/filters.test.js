import { describe, it, expect } from 'vitest'
import { PayloadType, getPayloadTypeName } from '@michaelhart/meshcore-decoder'
import { makeFilter, isFilterActive, DEFAULT_FILTER, packetTypeLabel, FILTER_PACKET_TYPES } from '../filters.js'

const rec = (o) => ({ sender_id: '4a', packet_type: 'Response', is_direct: true, hops: 0,
  rx_at: '2026-06-29T10:00:00Z', ...o })
const now = Date.parse('2026-06-29T10:05:00Z')

describe('makeFilter', () => {
  it('targets a single sender by exact id (case-insensitive)', () => {
    const f = makeFilter({ sender: { ids: ['4A'] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec(), now)).toBe(true)
    expect(f(rec({ sender_id: 'bb' }), now)).toBe(false)
    expect(f(rec({ sender_id: null }), now)).toBe(false)
  })
  it('targets the union (OR) of multiple sender ids', () => {
    const f = makeFilter({ sender: { ids: ['4a', 'bb'] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec({ sender_id: '4a' }), now)).toBe(true)
    expect(f(rec({ sender_id: 'BB' }), now)).toBe(true)
    expect(f(rec({ sender_id: 'cc' }), now)).toBe(false)
  })
  it('an empty target set does not filter by sender', () => {
    const f = makeFilter({ sender: { ids: [] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec({ sender_id: 'anything' }), now)).toBe(true)
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
  it('a target selection is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, sender: { ids: ['aa'] } })).toBe(true)
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

describe('packetTypeLabel', () => {
  it('maps a raw decoder packet_type to its friendly filter-chip label', () => {
    expect(packetTypeLabel('TextMessage')).toBe('Direct msg')
    expect(packetTypeLabel('GroupText')).toBe('Channel')
    expect(packetTypeLabel('Advert')).toBe('Advert')
  })
  it('falls back to the raw value for an unrecognised packet_type', () => {
    expect(packetTypeLabel('SomethingNew')).toBe('SomethingNew')
  })
  it('falls back to the raw value for null/undefined', () => {
    expect(packetTypeLabel(null)).toBe(null)
    expect(packetTypeLabel(undefined)).toBe(undefined)
  })
})

describe('FILTER_PACKET_TYPES', () => {
  // The chips are the only way to narrow by type, so a type the decoder can
  // name but the list doesn't carry is a reception nobody can filter for —
  // Control, Path and AnonRequest alone are 22% of the production data (#341).
  it('covers every packet type the decoder can name', () => {
    const covered = new Set(FILTER_PACKET_TYPES.map((t) => t.value))
    const missing = Object.values(PayloadType)
      .filter((v) => typeof v === 'number')
      .map((v) => getPayloadTypeName(v))
      .filter((name) => !covered.has(name))
    expect(missing).toEqual([])
  })
  it('has a unique value and a non-empty label per entry', () => {
    const values = FILTER_PACKET_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const t of FILTER_PACKET_TYPES) expect(t.label).toBeTruthy()
  })
})
