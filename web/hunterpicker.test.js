import { describe, it, expect } from 'vitest'
import { hunterOptionLabel, dedupeHunterActivity, hunterList, topHunters, withoutHunterFilter, keptSelection } from './hunterpicker.js'

const h = (o) => ({ hunter_pubkey: 'h1', hunter_name: '', count: 0, ...o })
const pt = (o) => ({ lat: 51, lon: 4, rssi: -80, rx_at: '2026-07-22T10:00:00Z', ...o })

describe('hunterOptionLabel', () => {
  it('uses the pseudonym name for guests', () => {
    expect(hunterOptionLabel({ hunter_pubkey: 'h3', hunter_name: 'Hunter 3', count: 42 }))
      .toBe('Hunter 3 (42)')
  })
  it('falls back to a pubkey prefix when unnamed', () => {
    expect(hunterOptionLabel({ hunter_pubkey: 'abcdef0123456789', hunter_name: '', count: 5 }))
      .toBe('abcdef01 (5)')
  })
})

describe('dedupeHunterActivity — most-recent rx_at per hunter_pubkey', () => {
  it('keeps the newest reception time for a repeated hunter', () => {
    const points = [
      pt({ hunter_pubkey: 'h1', rx_at: '2026-07-22T10:00:00Z' }),
      pt({ hunter_pubkey: 'h1', rx_at: '2026-07-22T10:05:00Z' }),
      pt({ hunter_pubkey: 'h2', rx_at: '2026-07-22T10:01:00Z' }),
    ]
    const activity = dedupeHunterActivity(points)
    expect(activity.get('h1')).toBe('2026-07-22T10:05:00Z')
    expect(activity.get('h2')).toBe('2026-07-22T10:01:00Z')
  })
  it('drops rows with no hunter_pubkey', () => {
    expect(dedupeHunterActivity([pt({ hunter_pubkey: null }), pt({ hunter_pubkey: '' })]).size).toBe(0)
  })
  it('handles empty/missing input', () => {
    expect(dedupeHunterActivity([]).size).toBe(0)
    expect(dedupeHunterActivity(undefined).size).toBe(0)
  })
})

describe('hunterList — label-sorted (case-insensitive), optionally limited', () => {
  const hunters = [
    h({ hunter_pubkey: 'cc', hunter_name: 'Charlie', count: 1 }),
    h({ hunter_pubkey: 'aa', hunter_name: 'Alpha', count: 2 }),
    h({ hunter_pubkey: 'bb', hunter_name: '', count: 3 }), // unnamed -> sorts by pubkey prefix
  ]
  it('sorts by hunterOptionLabel (name, falling back to pubkey prefix), case-insensitive', () => {
    expect(hunterList(hunters).map((r) => r.hunter_pubkey)).toEqual(['aa', 'bb', 'cc'])
  })
  it('respects a limit', () => {
    expect(hunterList(hunters, { limit: 2 })).toHaveLength(2)
  })
})

describe('topHunters — pinned by recent activity, not reception count', () => {
  it('ranks the most recently active hunter first, regardless of count', () => {
    const hunters = [
      h({ hunter_pubkey: 'stale', count: 999 }),
      h({ hunter_pubkey: 'fresh', count: 1 }),
    ]
    const points = [
      pt({ hunter_pubkey: 'stale', rx_at: '2026-07-22T09:00:00Z' }), // 70 min old
      pt({ hunter_pubkey: 'fresh', rx_at: '2026-07-22T10:09:50Z' }), // 10s old
    ]
    expect(topHunters(hunters, points, { count: 2 }).map((r) => r.hunter_pubkey)).toEqual(['fresh', 'stale'])
  })
  it('excludes a hunter with no activity in the candidate point set', () => {
    const hunters = [h({ hunter_pubkey: 'active' }), h({ hunter_pubkey: 'idle' })]
    const points = [pt({ hunter_pubkey: 'active', rx_at: '2026-07-22T10:00:00Z' })]
    expect(topHunters(hunters, points, { count: 3 }).map((r) => r.hunter_pubkey)).toEqual(['active'])
  })
  it('caps to count', () => {
    const hunters = ['a', 'b', 'c', 'd'].map((id) => h({ hunter_pubkey: id }))
    const points = ['a', 'b', 'c', 'd'].map((id) => pt({ hunter_pubkey: id }))
    expect(topHunters(hunters, points, { count: 3 })).toHaveLength(3)
  })
  it('handles an empty roster or empty candidate points', () => {
    expect(topHunters([], [], { count: 3 })).toEqual([])
    expect(topHunters([h({ hunter_pubkey: 'a' })], [], { count: 3 })).toEqual([])
  })
})

describe('withoutHunterFilter — candidate pool must not narrow by the hunter selection', () => {
  it('drops the hunter filter and keeps everything else', () => {
    const f = { hunter: 'abc', senderPairs: [], types: 'advert', hops: '0' }
    expect(withoutHunterFilter(f)).toEqual({ senderPairs: [], types: 'advert', hops: '0' })
  })
  it('tolerates an absent or empty filter object', () => {
    expect(withoutHunterFilter({})).toEqual({})
    expect(withoutHunterFilter()).toEqual({})
  })
})

// #463: the roster is refetched when the role changes, and the ids in it
// change with the role. A guest picks pseudonym tokens (h3), a member real
// pubkeys, and a hunter sees their own pubkey among the pseudonyms, so the
// selection that survives a refetch is whatever the new roster still names.
describe('keptSelection', () => {
  const roster = [{ hunter_pubkey: 'abc123', hunter_name: 'ON8AR', count: 4 }, { hunter_pubkey: 'h2', hunter_name: 'Hunter 2', count: 1 }]
  it('keeps the ids the new roster names and drops the rest, in the order picked', () => {
    expect(keptSelection(['h9', 'h2', 'abc123'], roster)).toEqual(['h2', 'abc123'])
  })
  it('is empty for an empty pick or an empty roster', () => {
    expect(keptSelection([], roster)).toEqual([])
    expect(keptSelection(['h2'], [])).toEqual([])
    expect(keptSelection(undefined, roster)).toEqual([])
  })
})
