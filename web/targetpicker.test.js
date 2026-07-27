import { describe, it, expect } from 'vitest'
import {
  dedupeSenders, senderList, topSenders, targetParts, relTime,
  senderParams, encodeSelection, decodeSelection, withoutSenderFilters,
} from './targetpicker.js'

const pt = (o) => ({ lat: 51, lon: 4, rssi: -80, rx_at: '2026-07-22T10:00:00Z', ...o })

describe('dedupeSenders — one row per sender_id, keeping the most recent', () => {
  it('collapses repeated senders to their newest reception', () => {
    const rows = [
      pt({ sender_id: 'aa', rssi: -90, rx_at: '2026-07-22T10:00:00Z' }),
      pt({ sender_id: 'aa', rssi: -70, rx_at: '2026-07-22T10:05:00Z' }),
      pt({ sender_id: 'bb', rx_at: '2026-07-22T10:01:00Z' }),
    ]
    const out = dedupeSenders(rows)
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.sender_id === 'aa').rssi).toBe(-70)
  })
  it('drops rows with no sender_id', () => {
    expect(dedupeSenders([pt({ sender_id: null }), pt({ sender_id: '' })])).toEqual([])
  })
  it('handles empty/missing input', () => {
    expect(dedupeSenders([])).toEqual([])
    expect(dedupeSenders(undefined)).toEqual([])
  })
})

describe('senderList — name-sorted (case-insensitive), optionally limited', () => {
  const rows = [
    pt({ sender_id: 'cc', sender_label: 'charlie' }),
    pt({ sender_id: 'aa', sender_label: 'Alpha' }),
    pt({ sender_id: 'bb', sender_label: '' }), // unresolved -> sorts by id
  ]
  it('sorts by label (falling back to id), case-insensitive', () => {
    expect(senderList(rows).map((r) => r.sender_id)).toEqual(['aa', 'bb', 'cc'])
  })
  it('respects a limit', () => {
    expect(senderList(rows, { limit: 2 })).toHaveLength(2)
  })
})

describe('topSenders — recency+RSSI score, ~1dB per 30s of age', () => {
  it('ranks a strong-but-stale sender below a weaker-but-fresh one', () => {
    const now = Date.parse('2026-07-22T10:10:00Z')
    const rows = [
      pt({ sender_id: 'stale', rssi: -50, rx_at: '2026-07-22T09:00:00Z' }), // 70 min old
      pt({ sender_id: 'fresh', rssi: -80, rx_at: '2026-07-22T10:09:50Z' }), // 10s old
    ]
    expect(topSenders(rows, { nowMs: now, count: 2 }).map((r) => r.sender_id)).toEqual(['fresh', 'stale'])
  })
  it('caps to count', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => pt({ sender_id: id }))
    expect(topSenders(rows, { nowMs: Date.now(), count: 3 })).toHaveLength(3)
  })
})

describe('targetParts — primary/secondary label split', () => {
  it('shows the resolved name as primary, byte-prefix as secondary', () => {
    expect(targetParts(pt({ sender_id: 'aa11bb22cc33', sender_label: 'NEO7HI' })))
      .toEqual({ primary: 'NEO7HI', secondary: 'aa11bb' })
  })
  it('falls back to the id prefix + a marker when unresolved', () => {
    expect(targetParts(pt({ sender_id: 'aa11bb22cc33', sender_label: '' })))
      .toEqual({ primary: 'aa11bb (name not resolved)', secondary: 'aa11bb' })
  })
  it('handles a missing id', () => {
    expect(targetParts(pt({ sender_id: null, sender_label: '' }))).toEqual({ primary: '—', secondary: '' })
  })
})

describe('relTime — ported from app/src/feed.js (not shared: web\'s data model differs, #223)', () => {
  const NOW = Date.parse('2026-07-22T10:00:00Z')
  it('formats seconds/minutes/hours', () => {
    expect(relTime('2026-07-22T09:59:45Z', NOW)).toBe('15s')
    expect(relTime('2026-07-22T09:55:00Z', NOW)).toBe('5m')
  })
  it('returns — for missing/invalid timestamps', () => {
    expect(relTime(null, NOW)).toBe('—')
  })
})


// #223/#288: the wire format. Exact picks go out as a repeated ?senders=
// param and the prefix search keeps ?sender=, so no delimiter has to be
// unreachable inside a sender_id. senderParams turns a parsed field into the
// [key, value] pairs a URLSearchParams should carry.
describe('senderParams — the two sender filters on two params (#223)', () => {
  it('emits one senders= entry per picked id', () => {
    expect(senderParams({ ids: ['aaaa', 'bbbb'], prefix: '' }))
      .toEqual([['senders', 'aaaa'], ['senders', 'bbbb']])
  })
  it('emits a single senders= for a one-id pick, with no delimiter trick', () => {
    expect(senderParams({ ids: ['aaaa'], prefix: '' })).toEqual([['senders', 'aaaa']])
  })
  it('keeps punctuation in a picked id intact, which is the whole point', () => {
    expect(senderParams({ ids: ['bob; k.'], prefix: '' })).toEqual([['senders', 'bob; k.']])
  })
  it('sends a typed prefix on sender=, never senders=', () => {
    expect(senderParams({ ids: [], prefix: 'Bob; K.' })).toEqual([['sender', 'Bob; K.']])
  })
  it('lets a picked selection win over a stale typed prefix', () => {
    // Picking and typing are different match kinds (exact vs leading-prefix);
    // combining them silently would be surprising, so the pick wins.
    expect(senderParams({ ids: ['aaaa'], prefix: 'bb' })).toEqual([['senders', 'aaaa']])
  })
  it('emits nothing when neither filter is active', () => {
    expect(senderParams({ ids: [], prefix: '' })).toEqual([])
    expect(senderParams({})).toEqual([])
    expect(senderParams()).toEqual([])
  })
})

// The picker's selection is its own state now, so it needs its own encoding
// for the shareable URL and localStorage. A sender_id is arbitrary operator
// text, so the encoding cannot be delimiter-joined either — JSON survives any
// content, and a corrupt value degrades to "nothing selected" rather than
// throwing during boot.
describe('encodeSelection / decodeSelection (#288)', () => {
  it('round-trips ids containing every delimiter we ever tried', () => {
    const ids = ['bob, k.', 'ann;b', 'x"y', 'plain']
    expect(decodeSelection(encodeSelection(ids))).toEqual(ids)
  })
  it('encodes an empty selection as an empty string, so the param drops out', () => {
    expect(encodeSelection([])).toBe('')
    expect(encodeSelection(null)).toBe('')
  })
  it('decodes junk to an empty selection instead of throwing', () => {
    for (const junk of ['', 'not json', '{}', '[1,2]', 'null', undefined]) {
      expect(decodeSelection(junk)).toEqual([])
    }
  })
  it('drops non-string and blank entries from a decoded list', () => {
    expect(decodeSelection('["aa", 3, "", "  ", "bb"]')).toEqual(['aa', 'bb'])
  })
})

// #288 blocker 4: the candidate pool is what you pick FROM, so it must not
// narrow by the sender filters — otherwise selecting a sender shrinks the list
// you are selecting from, and every click refetches. Both sender inputs travel
// under one key (senderPairs), so one exclusion covers the selection and the
// typed prefix together. Named here rather than inlined at the call site: the
// key was renamed once already and the stale literal silently re-broke the
// cache without failing anything.
describe('withoutSenderFilters (#288)', () => {
  it('drops the sender filters and keeps everything else', () => {
    const f = { hunter: 'abc', senderPairs: [['senders', 'aa']], types: 'advert', hops: '0' }
    expect(withoutSenderFilters(f)).toEqual({ hunter: 'abc', types: 'advert', hops: '0' })
  })

  it('gives the same result whatever the selection is, so the cache holds', () => {
    const base = { hunter: 'abc', types: 'advert' }
    const none = withoutSenderFilters({ ...base, senderPairs: [] })
    const one = withoutSenderFilters({ ...base, senderPairs: [['senders', 'aa']] })
    const many = withoutSenderFilters({ ...base, senderPairs: [['senders', 'aa'], ['senders', 'bb']] })
    const typed = withoutSenderFilters({ ...base, senderPairs: [['sender', 'bo']] })
    expect(one).toEqual(none)
    expect(many).toEqual(none)
    expect(typed).toEqual(none)
  })

  it('never leaks senderPairs through, which would stringify an array into the query', () => {
    expect(Object.keys(withoutSenderFilters({ senderPairs: [['senders', 'aa']] }))).toEqual([])
  })

  it('tolerates an absent or empty filter object', () => {
    expect(withoutSenderFilters({})).toEqual({})
    expect(withoutSenderFilters()).toEqual({})
  })
})
