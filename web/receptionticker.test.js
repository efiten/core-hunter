import { describe, it, expect } from 'vitest'
import { rxView, rxActiveIndex, rxFade, receptionKey, tickerFilters, isLiveWindow, relTime } from './receptionticker.js'

// rxView/rxActiveIndex/rxFade are ported verbatim from app/src/receptionlog.js
// (#238 explicitly excludes this file from the shared-core extraction, since
// web's rows arrive via HTTP poll rather than a local IndexedDB store) --
// same tests as app/src/__tests__/receptionlog.test.js, so a future drift
// between the two copies shows up as a failing test in both places.
const rec = (o) => ({ id: 1, rx_at: '2026-06-29T10:00:00Z', ...o })

describe('rxView — source select, ascending by rx_at, recent cap', () => {
  const filtered = [rec({ id: 1, rx_at: '2026-06-29T10:00:00Z' }), rec({ id: 2, rx_at: '2026-06-29T10:02:00Z' })]
  const all = [...filtered, rec({ id: 3, rx_at: '2026-06-29T10:01:00Z' })]

  it('filtered mode returns the filtered set, all mode the full set', () => {
    expect(rxView(filtered, all, 'filtered').map((r) => r.id)).toEqual([1, 2])
    expect(rxView(filtered, all, 'all').map((r) => r.id).sort()).toEqual([1, 2, 3])
  })
  it('sorts ascending by rx_at (newest last)', () => {
    expect(rxView(filtered, all, 'all').map((r) => r.id)).toEqual([1, 3, 2])
  })
  it('caps to the most recent N, dropping the oldest', () => {
    const many = Array.from({ length: 10 }, (_, i) => rec({ id: i, rx_at: `2026-06-29T10:0${i}:00Z` }))
    expect(rxView(many, many, 'filtered', 3).map((r) => r.id)).toEqual([7, 8, 9])
  })
  it('handles empty / missing input', () => {
    expect(rxView([], [], 'filtered')).toEqual([])
    expect(rxView(undefined, undefined, 'all')).toEqual([])
  })
})

describe('rxActiveIndex — playhead index from scroll, clamped', () => {
  it('rounds scrollTop/lineH', () => {
    expect(rxActiveIndex(0, 20, 10)).toBe(0)
    expect(rxActiveIndex(58, 20, 10)).toBe(3)
  })
  it('clamps to [0, count-1] and returns -1 when empty', () => {
    expect(rxActiveIndex(-40, 20, 10)).toBe(0)
    expect(rxActiveIndex(9999, 20, 10)).toBe(9)
    expect(rxActiveIndex(0, 20, 0)).toBe(-1)
  })
})

describe('rxFade — playhead-relative opacity (6 above, 3 below, faster below)', () => {
  it('is 1 on the lane', () => { expect(rxFade(0)).toBe(1) })
  it('fades over ~6 lines above (negative d)', () => {
    expect(rxFade(-3)).toBeCloseTo(0.5)
    expect(rxFade(-6)).toBe(0)
  })
  it('fades faster over ~3 lines below (positive d)', () => {
    expect(rxFade(1)).toBeCloseTo(2 / 3)
    expect(rxFade(3)).toBe(0)
  })
})

describe('receptionKey — synthetic per-row identity (#224)', () => {
  // /api/points rows carry no stable row id (server/internal/store/query.go's
  // Point struct has none) -- unlike app, whose rows are IndexedDB records
  // with an autoincrement id. The map<->ticker two-way sync needs SOME shared
  // key so a marker and a ticker line referring to the same reception agree
  // on identity; this composes one from fields the API does return.
  const pt = { rx_at: '2026-06-29T10:00:00Z', sender_id: 'aa11', hunter_pubkey: 'h1', lat: 51, lon: 4, rssi: -90 }

  it('is identical for two fetches of the same underlying row', () => {
    expect(receptionKey({ ...pt })).toBe(receptionKey({ ...pt }))
  })
  it('differs when any identifying field differs', () => {
    const base = receptionKey(pt)
    expect(receptionKey({ ...pt, sender_id: 'bb22' })).not.toBe(base)
    expect(receptionKey({ ...pt, rx_at: '2026-06-29T10:00:01Z' })).not.toBe(base)
    expect(receptionKey({ ...pt, hunter_pubkey: 'h2' })).not.toBe(base)
    expect(receptionKey({ ...pt, lat: 51.001 })).not.toBe(base)
  })
})

describe('tickerFilters — "all" mode drops sender/types/hops, keeps hunter+time', () => {
  // Web has no local store of "every reception ever" the way app does (its
  // IndexedDB queue is the working set) -- the backend may hold months of
  // history. "all" here means "every reception in the current hunter+time
  // window, ignoring the sender/type/direct-only narrowing", not literally
  // unbounded — a deliberate, smaller scope than app's "all", called out here
  // and in the PR description since it's a real interpretation choice.
  const filters = { hunter: 'h1', sender: 'aa', from: '2026-01-01', to: '2026-01-02', types: 'Advert', hops: '0' }

  it('filtered mode passes every field through unchanged', () => {
    expect(tickerFilters(filters, 'filtered')).toEqual(filters)
  })
  it('all mode drops sender/types/hops, keeps hunter/from/to', () => {
    expect(tickerFilters(filters, 'all')).toEqual({ hunter: 'h1', sender: '', from: '2026-01-01', to: '2026-01-02', types: '', hops: '' })
  })
})

describe('relTime — ported from app/src/feed.js (not shared by #238)', () => {
  const NOW = Date.parse('2026-06-29T10:00:00Z')

  it('formats seconds, minutes, hours', () => {
    expect(relTime('2026-06-29T09:59:45Z', NOW)).toBe('15s')
    expect(relTime('2026-06-29T09:55:00Z', NOW)).toBe('5m')
    expect(relTime('2026-06-29T07:00:00Z', NOW)).toBe('3h')
  })
  it('returns — for missing/invalid timestamps', () => {
    expect(relTime(null, NOW)).toBe('—')
    expect(relTime('not-a-date', NOW)).toBe('—')
  })
})

describe('isLiveWindow — gates the recurring poll to a "now"-ish range (#224)', () => {
  const NOW = Date.parse('2026-07-22T15:00:00Z')

  it('is live when `to` is empty (no upper bound)', () => {
    expect(isLiveWindow('', NOW)).toBe(true)
  })
  it('is live when `to` falls on today (local calendar date)', () => {
    expect(isLiveWindow('2026-07-22T21:59:00.000Z', NOW)).toBe(true)
  })
  it('is not live when `to` is a past date', () => {
    expect(isLiveWindow('2026-07-01T21:59:00.000Z', NOW)).toBe(false)
  })
  it('is not live when `to` is a future date', () => {
    expect(isLiveWindow('2026-08-01T21:59:00.000Z', NOW)).toBe(false)
  })
})
