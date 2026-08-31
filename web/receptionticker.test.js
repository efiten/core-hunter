import { describe, it, expect } from 'vitest'
import { rxView, rxActiveIndex, rxFade, rxLineHeight, receptionKey, tickerFilters, isLiveWindow, relTime, pointInRing, newestInRing , RX_FADE_FLOOR, rxLanes, RX_COLLAPSE_STOPS, collapseLevels } from './receptionticker.js'

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

describe('rxFade, playhead-relative opacity', () => {
  it('is 1 on the lane', () => { expect(rxFade(0)).toBe(1) })

  // Each side fades across the lanes there actually are on it, and stops at a
  // floor rather than at nothing (#424, mirroring #560). The old fixed divisors
  // reached zero on the outermost lane of each side, which was harmless while
  // those lanes were blank padding and is not now that they hold receptions:
  // the newest one lives on the last lane below the playhead.
  it('fades older rows across the span it is given, down to the floor', () => {
    expect(rxFade(-6, 6, 3)).toBe(RX_FADE_FLOOR)
    expect(rxFade(-1, 6, 3)).toBeGreaterThan(rxFade(-5, 6, 3))
  })

  it('fades newer rows faster than older ones, and stops at the floor', () => {
    expect(rxFade(1, 6, 3)).toBeLessThan(rxFade(-1, 6, 3))
    expect(rxFade(3, 6, 3), 'the newest row on a full card').toBe(RX_FADE_FLOOR)
    expect(rxFade(9, 6, 3), 'past the card, clamped').toBe(RX_FADE_FLOOR)
  })

  it('never hides a row the card has made room for', () => {
    for (const [above, below] of [[6, 3], [3, 1], [1, 1], [0, 0]]) {
      for (let d = -above; d <= below; d++) {
        expect(rxFade(d, above, below), `d=${d} of ${above}/${below}`).toBeGreaterThanOrEqual(RX_FADE_FLOOR)
      }
    }
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
  // senderPairs is where BOTH sender inputs live since #223 (the picker's
  // selection and the typed prefix); `sender` is kept for the older callers.
  const filters = { hunter: 'h1', sender: 'aa', senderPairs: [['senders', 'aa11bb22']], from: '2026-01-01', to: '2026-01-02', types: 'Advert', hops: '0' }

  it('filtered mode passes every field through unchanged', () => {
    expect(tickerFilters(filters, 'filtered')).toEqual(filters)
  })
  it('all mode drops sender/types/hops, keeps hunter/from/to', () => {
    expect(tickerFilters(filters, 'all')).toEqual({ hunter: 'h1', sender: '', senderPairs: [], from: '2026-01-01', to: '2026-01-02', types: '', hops: '' })
  })
  it('all mode drops the picker selection too, not just the typed prefix', () => {
    // Dropping only `sender` would leave the picked ids applied, so "all" would
    // silently still be narrowed to the selection.
    expect(tickerFilters(filters, 'all').senderPairs).toEqual([])
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
  it('is live when `to` is still ahead of now', () => {
    expect(isLiveWindow('2026-07-22T21:59:00.000Z', NOW)).toBe(true)
  })
  it('is not live when `to` has already passed', () => {
    expect(isLiveWindow('2026-07-01T21:59:00.000Z', NOW)).toBe(false)
  })
  // The gate is "does the window still include now", not "is `to` today".
  // A `to` in the future keeps the window open, so new receptions land inside
  // it and polling is what the user expects. The old assertion here (future =>
  // not live) was an artefact of the UTC-calendar-day comparison that #287
  // blocker 1 removed: it only looked false because a future date is a
  // different day, which is the same reasoning that broke the first two hours
  // of every local day for CEST and broke it all day for negative offsets.
  it('is live when `to` is far in the future — the window still contains now', () => {
    expect(isLiveWindow('2026-08-01T21:59:00.000Z', NOW)).toBe(true)
  })
  it('is live exactly at the boundary, so the gate does not flicker shut on equality', () => {
    expect(isLiveWindow(new Date(NOW).toISOString(), NOW)).toBe(true)
  })
})

// #224 blocker 2: marker→ticker sync only existed for point markers, which are
// drawn in 'points'/'both' — and the cold default is 'hex' (#141), so a
// first-time visitor clicking the map got nothing. Hex cells are aggregates
// from /api/heatmap and carry no individual receptions, so the cell has to be
// matched against the receptions the ticker already holds.
describe('pointInRing', () => {
  // A hex ring as drawHex builds it: [lat, lon] pairs, closed.
  const ring = [[51.0, 4.0], [51.0, 4.2], [51.1, 4.3], [51.2, 4.2], [51.2, 4.0], [51.1, 3.9], [51.0, 4.0]]

  it('accepts a point well inside', () => {
    expect(pointInRing(51.1, 4.1, ring)).toBe(true)
  })
  it('rejects a point well outside', () => {
    expect(pointInRing(52.0, 4.1, ring)).toBe(false)
    expect(pointInRing(51.1, 9.9, ring)).toBe(false)
  })
  it('rejects a point beyond a slanted edge, not just the bounding box', () => {
    // Inside the bbox (lat 51.0-51.2, lon 3.9-4.3) but outside the hexagon.
    expect(pointInRing(51.01, 4.28, ring)).toBe(false)
  })
  it('returns false for a missing or degenerate ring rather than throwing', () => {
    expect(pointInRing(51.1, 4.1, [])).toBe(false)
    expect(pointInRing(51.1, 4.1, [[51, 4], [51, 4]])).toBe(false)
    expect(pointInRing(51.1, 4.1, null)).toBe(false)
  })
  it('returns false for a non-finite coordinate', () => {
    expect(pointInRing(null, 4.1, ring)).toBe(false)
    expect(pointInRing(51.1, undefined, ring)).toBe(false)
  })
})

describe('newestInRing', () => {
  const ring = [[51.0, 4.0], [51.0, 4.2], [51.1, 4.3], [51.2, 4.2], [51.2, 4.0], [51.1, 3.9], [51.0, 4.0]]
  const rec = (o) => ({ lat: 51.1, lon: 4.1, rx_at: '2026-07-22T10:00:00Z', ...o })

  it('picks the most recent reception inside the cell', () => {
    // Newest, not strongest: focusRecord moves the ticker's playhead, and the
    // ticker is ordered by time — jumping to an old strong line would scroll
    // away from what the user is watching.
    const out = newestInRing([
      rec({ rx_at: '2026-07-22T10:00:00Z', rssi: -60 }),
      rec({ rx_at: '2026-07-22T10:05:00Z', rssi: -95 }),
      rec({ rx_at: '2026-07-22T10:02:00Z', rssi: -50 }),
    ], ring)
    expect(out.rx_at).toBe('2026-07-22T10:05:00Z')
  })

  it('ignores receptions outside the cell even when they are newer', () => {
    const out = newestInRing([
      rec({ rx_at: '2026-07-22T10:00:00Z' }),
      rec({ lat: 52.0, lon: 4.1, rx_at: '2026-07-22T23:00:00Z' }),
    ], ring)
    expect(out.rx_at).toBe('2026-07-22T10:00:00Z')
  })

  it('returns null when the cell holds none of the loaded receptions', () => {
    // Expected and common: the ticker caps at 200 recent rows, so a cell built
    // from the full history often has nothing loaded. The caller must treat
    // this as "no sync available", not as an error.
    expect(newestInRing([rec({ lat: 52.0, lon: 9.0 })], ring)).toBeNull()
    expect(newestInRing([], ring)).toBeNull()
    expect(newestInRing(null, ring)).toBeNull()
  })

  it('skips rows with no usable position or timestamp', () => {
    const out = newestInRing([
      rec({ lat: null, rx_at: '2026-07-22T23:00:00Z' }),
      rec({ rx_at: 'not-a-date' }),
      rec({ rx_at: '2026-07-22T10:01:00Z' }),
    ], ring)
    expect(out.rx_at).toBe('2026-07-22T10:01:00Z')
  })
})

// rxLineHeight (#322) — ported from app/src/receptionlog.js with the same
// fallback, since both stylesheets ship the same row height. See the parity
// suite for the assertion that the two copies and the two stylesheets agree.
describe('rxLineHeight — row height parsed from the CSS variable', () => {
  it('parses a px value', () => {
    expect(rxLineHeight('26px')).toBe(26)
    expect(rxLineHeight(' 26px ')).toBe(26)
  })
  it('accepts a bare number and a fractional value', () => {
    expect(rxLineHeight('26')).toBe(26)
    expect(rxLineHeight('25.5px')).toBe(25.5)
  })
  it('falls back to the shipped row height when the variable is absent or unusable', () => {
    expect(rxLineHeight('')).toBe(26)
    expect(rxLineHeight(null)).toBe(26)
    expect(rxLineHeight('inherit')).toBe(26)
    expect(rxLineHeight('0px')).toBe(26)
    expect(rxLineHeight('-4px')).toBe(26)
  })
})

// Putting the ticker away is the cross now, not a further shrink stop, so the
// map's stops are the app's exactly (#424). parity.test.js pins that equality;
// this pins that nothing here still expects a zero-lane stop.
describe('the map\'s collapse stops', () => {
  it('shrink the card without ever emptying it', () => {
    for (let level = 1; level <= RX_COLLAPSE_STOPS.length; level++) {
      expect(rxLanes(50, level), `stop ${level}`).toBeGreaterThan(0)
    }
    expect(RX_COLLAPSE_STOPS).toEqual([3, 1])
  })

  it('are offered only while one of them would change the card', () => {
    expect(collapseLevels(1)).toEqual([0])
    expect(collapseLevels(3)).toEqual([0, 2])
    expect(collapseLevels(50)).toEqual([0, 1, 2])
  })
})
