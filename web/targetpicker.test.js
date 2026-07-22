import { describe, it, expect } from 'vitest'
import {
  dedupeSenders, senderList, topSenders, targetParts, relTime,
  parseSenderField, senderQueryParam, matchesSenderIds, toggleSenderId,
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

describe('parseSenderField — disambiguates #f-sender\'s reused value (#223)', () => {
  // Decision: the picker and the free-text prefix field share the SAME
  // `sender` param/URL state (Kasper, 2026-07-22) rather than a separate one.
  // A comma means "exact-id multi-select from the picker"; anything else is
  // the pre-existing single leading-prefix search, unchanged.
  it('empty value -> no filter', () => {
    expect(parseSenderField('')).toEqual({ mode: 'none' })
  })
  it('a single value with no comma -> prefix search (unchanged existing behaviour)', () => {
    expect(parseSenderField('aa11')).toEqual({ mode: 'prefix', prefix: 'aa11' })
  })
  it('a comma-separated value -> exact-id set, lowercased', () => {
    expect(parseSenderField('AA11,bb22')).toEqual({ mode: 'ids', ids: ['aa11', 'bb22'] })
  })
  it('trims whitespace and drops empty entries around commas', () => {
    expect(parseSenderField(' aa11 , ,bb22 ')).toEqual({ mode: 'ids', ids: ['aa11', 'bb22'] })
  })
})

describe('senderQueryParam — what actually goes to the server\'s sender= param', () => {
  // The server only does a single leading-prefix LIKE match
  // (server/internal/store/query.go) -- it cannot OR multiple exact ids. A
  // multi-select must NOT be forwarded there (it would prefix-match the
  // literal joined string and return nothing); the ids-mode filtering
  // happens client-side instead (matchesSenderIds), after a broader fetch.
  it('passes a plain prefix through unchanged', () => {
    expect(senderQueryParam('aa11')).toBe('aa11')
  })
  it('is empty for a multi-id selection (filtered client-side instead)', () => {
    expect(senderQueryParam('aa11,bb22')).toBe('')
  })
  it('is empty when there is no filter', () => {
    expect(senderQueryParam('')).toBe('')
  })
})

describe('matchesSenderIds — client-side exact-id filter for the multi-select case', () => {
  it('matches case-insensitively', () => {
    expect(matchesSenderIds(pt({ sender_id: 'AA11' }), ['aa11', 'bb22'])).toBe(true)
    expect(matchesSenderIds(pt({ sender_id: 'cc33' }), ['aa11', 'bb22'])).toBe(false)
  })
  it('never matches a row with no sender_id', () => {
    expect(matchesSenderIds(pt({ sender_id: null }), ['aa11'])).toBe(false)
  })
})

describe('toggleSenderId — toggles one id within an already-ids-mode selection', () => {
  // Operates on a comma-joined ids representation ONLY -- it is not
  // responsible for deciding whether the picker's live selection should be
  // seeded from a bare (possibly-prefix) field value in the first place.
  // The DOM component owns that decision once, at creation/reload time (see
  // createTargetPicker): a comma present -> seed the ids Set from it; no
  // comma -> the picker starts with an empty selection instead of guessing
  // whether a bare value was a typed prefix or an earlier single pick (the
  // two are genuinely indistinguishable as one string -- a known, documented
  // round-trip limitation of reusing one field for both, #223). Every click
  // thereafter toggles within that already-unambiguous in-memory Set, so
  // accumulation across multiple clicks in one session always works.
  it('adds an id to an empty selection', () => {
    expect(toggleSenderId('', 'aa11')).toBe('aa11')
  })
  it('adds a second id, becoming a comma-list', () => {
    expect(toggleSenderId('aa11', 'bb22')).toBe('aa11,bb22')
  })
  it('removes an id already selected', () => {
    expect(toggleSenderId('aa11,bb22', 'aa11')).toBe('bb22')
  })
  it('removing the last id clears the selection entirely', () => {
    expect(toggleSenderId('aa11', 'aa11')).toBe('')
  })
  it('is case-insensitive when checking membership', () => {
    expect(toggleSenderId('AA11', 'aa11')).toBe('')
  })
})
