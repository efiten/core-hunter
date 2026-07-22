import { describe, it, expect } from 'vitest'
import {
  dedupeSenders, senderList, topSenders, targetParts, relTime,
  parseSenderField, toggleSenderId,
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
  // A comma means "exact-id selection from the picker"; anything else is the
  // pre-existing single leading-prefix search, unchanged. The server applies
  // the same rule (server/internal/httpapi/api.go's filterFrom).
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
  // The trailing comma is what makes a ONE-id pick survive a reload/share as a
  // pick rather than degrading into a prefix search -- the two are otherwise
  // the same string. Ugly in the URL, but honest and lossless.
  it('a single id with a trailing comma -> a one-element exact set, not a prefix', () => {
    expect(parseSenderField('aa11,')).toEqual({ mode: 'ids', ids: ['aa11'] })
  })
})

describe('toggleSenderId — toggles one id, always emitting the ids-mode form', () => {
  // Output always contains a comma (trailing for a single id), so the result
  // is unambiguously a picker selection -- both on reload and to the server.
  it('adds an id to an empty selection, with a trailing comma', () => {
    expect(toggleSenderId('', 'aa11')).toBe('aa11,')
  })
  it('adds a second id, becoming a plain comma-list', () => {
    expect(toggleSenderId('aa11,', 'bb22')).toBe('aa11,bb22')
  })
  it('removes an id, dropping back to the trailing-comma single form', () => {
    expect(toggleSenderId('aa11,bb22', 'bb22')).toBe('aa11,')
  })
  it('removing the last id clears the selection entirely', () => {
    expect(toggleSenderId('aa11,', 'aa11')).toBe('')
  })
  it('is case-insensitive when checking membership', () => {
    expect(toggleSenderId('AA11,', 'aa11')).toBe('')
  })
  // Round-trip: whatever toggleSenderId emits must parse back to the same ids.
  it('emits a value parseSenderField reads back as the same id set', () => {
    const one = toggleSenderId('', 'aa11')
    expect(parseSenderField(one)).toEqual({ mode: 'ids', ids: ['aa11'] })
    const two = toggleSenderId(one, 'bb22')
    expect(parseSenderField(two)).toEqual({ mode: 'ids', ids: ['aa11', 'bb22'] })
  })
})
