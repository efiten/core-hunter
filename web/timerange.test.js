import { describe, it, expect } from 'vitest'
import {
  isTimeToken, resolveToken, resolveTimeValue,
  QUICK_RANGES, matchQuickRange, rangeLabel, absoluteShareUrl,
  toLocalInput, boundFromField,
  exceedsGuestWindow, rangeIsLive,
  COLD_START_RANGE, rangeForRole, rangeLabelFor,
  coverageLabel, coverageTitle, oldestRxAt,
} from './timerange.js'

// Fixed clock for every case below: 2026-07-22 15:30 local.
const NOW = new Date(2026, 6, 22, 15, 30, 0, 0).getTime()

describe('isTimeToken', () => {
  it('recognises now, now/d and now-<N><unit>', () => {
    for (const t of ['now', 'now/d', 'now-5m', 'now-12h', 'now-30d', 'now-2w']) {
      expect(isTimeToken(t)).toBe(true)
    }
  })
  it('rejects absolute values and junk', () => {
    for (const v of ['', '2026-07-22T00:00', 'now-', 'now-5', 'now-5y', 'later', 'now+1h']) {
      expect(isTimeToken(v)).toBe(false)
    }
  })
})

describe('resolveToken', () => {
  it('now is this instant', () => {
    expect(resolveToken('now', NOW)).toBe(NOW)
  })
  it('subtracts the right duration per unit', () => {
    expect(resolveToken('now-30m', NOW)).toBe(NOW - 30 * 60_000)
    expect(resolveToken('now-6h', NOW)).toBe(NOW - 6 * 3_600_000)
    expect(resolveToken('now-2d', NOW)).toBe(NOW - 2 * 86_400_000)
    expect(resolveToken('now-1w', NOW)).toBe(NOW - 7 * 86_400_000)
  })
  it('now/d is local midnight today, not UTC midnight', () => {
    const d = new Date(resolveToken('now/d', NOW))
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0])
    expect(d.getDate()).toBe(new Date(NOW).getDate())
  })
  it('returns null for non-tokens so callers fall through to absolute parsing', () => {
    expect(resolveToken('2026-07-22T00:00', NOW)).toBeNull()
    expect(resolveToken('', NOW)).toBeNull()
  })
})

describe('resolveTimeValue — the single conversion point to ISO-UTC', () => {
  it('resolves a relative token', () => {
    expect(resolveTimeValue('now-1h', NOW)).toBe(new Date(NOW - 3_600_000).toISOString())
  })
  it('converts an absolute datetime-local value as LOCAL time', () => {
    // Same contract as the old localToUTC: no zone suffix means browser-local.
    const local = new Date(2026, 6, 22, 9, 15)
    expect(resolveTimeValue('2026-07-22T09:15', NOW)).toBe(local.toISOString())
  })
  it('empty in, empty out (an absent bound is not a filter)', () => {
    expect(resolveTimeValue('', NOW)).toBe('')
    expect(resolveTimeValue(null, NOW)).toBe('')
  })
  it('unparseable input yields empty rather than Invalid Date', () => {
    expect(resolveTimeValue('nonsense', NOW)).toBe('')
  })
})

describe('QUICK_RANGES / matchQuickRange', () => {
  it('every entry stores tokens, never resolved timestamps', () => {
    for (const q of QUICK_RANGES) {
      expect(isTimeToken(q.from)).toBe(true)
      expect(isTimeToken(q.to)).toBe(true)
    }
  })
  it('covers the ranges the issue asked for, today through last month', () => {
    const labels = QUICK_RANGES.map((q) => q.label)
    expect(labels).toContain('Last 6 hours') // the screenshot's selected row
    expect(labels).toContain('Today')
    expect(labels).toContain('Last 30 days')
  })
  it('matches a stored pair back to its quick range', () => {
    expect(matchQuickRange('now-6h', 'now').label).toBe('Last 6 hours')
    expect(matchQuickRange('now/d', 'now').label).toBe('Today')
  })
  it('returns null for an absolute or unrecognised pair', () => {
    expect(matchQuickRange('2026-07-22T00:00', '2026-07-22T23:59')).toBeNull()
    expect(matchQuickRange('now-6h', 'now-1h')).toBeNull()
  })
})

describe('rangeLabel — what the picker button shows', () => {
  it('names the quick range when the pair is one', () => {
    expect(rangeLabel('now-6h', 'now', NOW)).toBe('Last 6 hours')
    expect(rangeLabel('now/d', 'now', NOW)).toBe('Today')
  })
  it('shows an absolute span, time-only when both ends are today', () => {
    expect(rangeLabel('2026-07-22T00:00', '2026-07-22T23:59', NOW)).toBe('00:00 → 23:59')
  })
  it('includes the date for a bound on another day', () => {
    expect(rangeLabel('2026-07-20T08:00', '2026-07-22T23:59', NOW)).toBe('2026-07-20 08:00 → 23:59')
  })
  it('handles open-ended and empty ranges', () => {
    expect(rangeLabel('', '', NOW)).toBe('All time')
    expect(rangeLabel('2026-07-22T08:00', '', NOW)).toBe('From 08:00')
    expect(rangeLabel('', '2026-07-22T08:00', NOW)).toBe('Until 08:00')
  })
})

describe('absoluteShareUrl — the escape hatch from token semantics', () => {
  it('replaces tokens with resolved timestamps, leaving other params alone', () => {
    const out = absoluteShareUrl('https://x.eu/?mode=points&from=now-1h&to=now&z=12', 'now-1h', 'now', NOW)
    const u = new URL(out)
    expect(u.searchParams.get('from')).toBe(new Date(NOW - 3_600_000).toISOString())
    expect(u.searchParams.get('to')).toBe(new Date(NOW).toISOString())
    expect(u.searchParams.get('mode')).toBe('points')
    expect(u.searchParams.get('z')).toBe('12')
  })
  it('drops a bound that is empty rather than writing an empty param', () => {
    const u = new URL(absoluteShareUrl('https://x.eu/?from=now-1h', '', '', NOW))
    expect(u.searchParams.has('from')).toBe(false)
    expect(u.searchParams.has('to')).toBe(false)
  })
  it('is idempotent — resolving an already-absolute range changes nothing', () => {
    const abs = new Date(NOW).toISOString()
    const u = new URL(absoluteShareUrl(`https://x.eu/?from=${abs}`, abs, abs, NOW))
    expect(u.searchParams.get('from')).toBe(abs)
  })
})

// #289 blocker 4. The panel renders a resolved instant into a datetime-local
// field, which is a naive wall-clock string with no zone. On the DST fall-back
// night 02:30 local happens twice, so that string no longer identifies which
// instant produced it, and re-parsing it always yields the FIRST (summer-time)
// occurrence. Pressing Apply without editing anything therefore silently moved
// the window an hour into the past.
//
// The fix is to stop round-tripping: keep the instant that produced the string
// and reuse it when the field is untouched. Re-parsing is correct only for a
// value the user actually typed, where wall-clock IS the intent.
//
// TZ is pinned to Europe/Brussels in vitest.config.js; without that these
// assertions hold vacuously on a UTC runner.
describe('boundFromField — DST-safe read-back of the absolute fields (#289)', () => {
  // 2026-10-25: clocks go 03:00 CEST -> 02:00 CET. 01:30Z is the SECOND pass
  // through 02:30 local; 00:30Z was the first.
  const SECOND_PASS = Date.parse('2026-10-25T01:30:00Z')
  const FIRST_PASS = Date.parse('2026-10-25T00:30:00Z')

  it('renders both passes of the ambiguous hour to the same wall-clock string', () => {
    // This is the information loss the fix has to work around, pinned so a
    // change in trLocalInput can't quietly invalidate the rest of this block.
    expect(toLocalInput(SECOND_PASS)).toBe(toLocalInput(FIRST_PASS))
    expect(toLocalInput(SECOND_PASS)).toBe('2026-10-25T02:30')
  })

  it('preserves the exact instant when the field is untouched', () => {
    const rendered = { value: toLocalInput(SECOND_PASS), iso: new Date(SECOND_PASS).toISOString() }
    expect(boundFromField(rendered.value, rendered)).toBe(new Date(SECOND_PASS).toISOString())
  })

  it('does not silently fall back to the first occurrence', () => {
    const rendered = { value: toLocalInput(SECOND_PASS), iso: new Date(SECOND_PASS).toISOString() }
    expect(boundFromField(rendered.value, rendered)).not.toBe(new Date(FIRST_PASS).toISOString())
  })

  it('parses as local wall-clock once the user edits the field', () => {
    const rendered = { value: toLocalInput(SECOND_PASS), iso: new Date(SECOND_PASS).toISOString() }
    const edited = '2026-10-25T05:45'
    expect(boundFromField(edited, rendered)).toBe(new Date(Date.parse(edited)).toISOString())
  })

  it('parses as local wall-clock when nothing was rendered', () => {
    expect(boundFromField('2026-07-22T09:15', null)).toBe(new Date(2026, 6, 22, 9, 15).toISOString())
  })

  it('maps an empty field to an empty bound, so a cleared field is no filter', () => {
    expect(boundFromField('', { value: '2026-10-25T02:30', iso: 'x' })).toBe('')
    expect(boundFromField('   ', null)).toBe('')
  })

  it('round-trips a summer instant unchanged, the ordinary case', () => {
    const t = Date.parse('2026-07-22T07:15:00Z')
    const rendered = { value: toLocalInput(t), iso: new Date(t).toISOString() }
    expect(boundFromField(rendered.value, rendered)).toBe(new Date(t).toISOString())
  })
})

describe('exceedsGuestWindow — would the server clamp this range? (#300)', () => {
  const NOW = Date.parse('2026-07-22T15:00:00Z')

  it('is false for ranges inside the 24h the server allows', () => {
    expect(exceedsGuestWindow('now-1h', 'now', NOW)).toBe(false)
    expect(exceedsGuestWindow('now-24h', 'now', NOW)).toBe(false)
  })
  it('is true for the quick ranges hidden from a degraded role', () => {
    expect(exceedsGuestWindow('now-2d', 'now', NOW)).toBe(true)
    expect(exceedsGuestWindow('now-7d', 'now', NOW)).toBe(true)
    expect(exceedsGuestWindow('now-30d', 'now', NOW)).toBe(true)
  })
  it('treats an open-ended start as unbounded, not as zero', () => {
    // No `from` means "everything", which is the most clamped case of all.
    expect(exceedsGuestWindow('', 'now', NOW)).toBe(true)
  })
  it('measures the span, not the distance from now', () => {
    // A historical one-hour window is inside the cap even though it is old;
    // the server clamps by window start, so the label should not cry wolf.
    expect(exceedsGuestWindow('2026-07-01T10:00', '2026-07-01T11:00', NOW)).toBe(false)
    expect(exceedsGuestWindow('2026-07-01T10:00', '2026-07-05T10:00', NOW)).toBe(true)
  })
  it('flags an unparseable start, because that is unbounded in practice', () => {
    // Junk resolves to no `from`, qs() drops the param, and the server then
    // clamps a degraded role to 24h — so the range really is capped and the
    // label should say so. Same path as an empty start, deliberately.
    expect(exceedsGuestWindow('nonsense', 'now', NOW)).toBe(true)
  })
})

// #440 follow-up. The auto-refresh asked "is this range relative", which was
// the right question while its reason was keeping `now-1h` rolling. The
// cold-start default became All time -- empty from and to, not a token -- so
// the timer was never created and the map never refreshed itself. A hunter
// watching a live drive saw the page as it loaded and no further (2026-08-24).
describe('rangeIsLive', () => {
  const LIVE_NOW = Date.parse('2026-08-24T21:00:00Z')

  it('says yes for All time, which is the default and was the bug', () => {
    expect(rangeIsLive('', '', LIVE_NOW)).toBe(true)
  })

  it('says yes for anything open-ended, however the start is written', () => {
    expect(rangeIsLive('now-1h', '', LIVE_NOW)).toBe(true)
    expect(rangeIsLive('2026-08-01T00:00:00Z', '', LIVE_NOW)).toBe(true)
  })

  it('says yes for a relative end, which is what it always used to catch', () => {
    expect(rangeIsLive('now-7d', 'now', LIVE_NOW)).toBe(true)
  })

  it('says yes for a window that SLIDES, even though its end is in the past', () => {
    // `now-1h` as the end resolves to an hour ago, so a plain "is the end
    // behind us" test calls it finished. It is not: the whole window moves
    // with the clock, and new receptions enter it as old ones leave. This is
    // the case the token branch exists for -- `to: 'now'` alone does not pin
    // it, because that resolves to exactly now and passes either way.
    expect(rangeIsLive('now-2h', 'now-1h', LIVE_NOW)).toBe(true)
  })

  it('says no for a range that has already finished', () => {
    // Nothing new can fall inside it, so polling it is pure cost.
    expect(rangeIsLive('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', LIVE_NOW)).toBe(false)
  })

  it('says yes for a range whose end is still ahead', () => {
    expect(rangeIsLive('2026-08-24T00:00:00Z', '2026-08-25T00:00:00Z', LIVE_NOW)).toBe(true)
  })

  it('refreshes rather than freezes when the end cannot be read', () => {
    // A stale map is the worse failure: it looks like working data.
    expect(rangeIsLive('', 'not a date', LIVE_NOW)).toBe(true)
  })
})

// #492: a cold start asks for 30 days rather than everything. "All time" was
// never delivered -- /api/heatmap caps at the newest 50 000 rows in the bbox
// (server/internal/httpapi/api.go), so the button promised a history the
// server truncates without saying so. 30 days is a window it can return.
describe('COLD_START_RANGE', () => {
  it('is a rolling 30 days, stored as tokens so a shared link keeps rolling', () => {
    expect(COLD_START_RANGE).toEqual({ from: 'now-30d', to: 'now' })
    expect(isTimeToken(COLD_START_RANGE.from)).toBe(true)
    expect(isTimeToken(COLD_START_RANGE.to)).toBe(true)
  })
  it('is one of the quick ranges, so the picker marks it active', () => {
    expect(matchQuickRange(COLD_START_RANGE.from, COLD_START_RANGE.to)?.label).toBe('Last 30 days')
  })
})

describe('rangeForRole — an empty range is not a state below member (#492)', () => {
  it('fills an empty range for a degraded role', () => {
    expect(rangeForRole('', '', { degraded: true })).toEqual(COLD_START_RANGE)
  })
  it('leaves a member on all time', () => {
    expect(rangeForRole('', '', { degraded: false })).toEqual({ from: '', to: '' })
    expect(rangeForRole('', '')).toEqual({ from: '', to: '' })
  })
  // A shared link carrying only one bound stays open-ended: that is a range
  // somebody chose, not the absence of one (the #285 guarantee).
  it('does not touch a half-open range', () => {
    expect(rangeForRole('now-6h', '', { degraded: true })).toEqual({ from: 'now-6h', to: '' })
    expect(rangeForRole('', 'now', { degraded: true })).toEqual({ from: '', to: 'now' })
  })
  it('leaves a range the viewer already has', () => {
    expect(rangeForRole('now-7d', 'now', { degraded: true })).toEqual({ from: 'now-7d', to: 'now' })
  })
})

describe('rangeLabelFor — the clamp note names the layer it applies to (#492)', () => {
  const NOW = Date.parse('2026-07-22T12:00:00Z')
  // Since #466 the hex layer is NOT windowed for a guest, only /api/points is
  // (applyGuestWindowCap). A flat "(24 h max)" described the layer the visitor
  // is usually not looking at: the map opens on hex.
  it('says nothing extra on the hex layer, whatever the range', () => {
    expect(rangeLabelFor('now-30d', 'now', NOW, { degraded: true, showsPoints: false })).toBe('Last 30 days')
  })
  it('names the points layer when that layer is on and the range exceeds 24 h', () => {
    expect(rangeLabelFor('now-30d', 'now', NOW, { degraded: true, showsPoints: true })).toBe('Last 30 days (points: 24 h)')
  })
  it('says nothing for a range inside the window', () => {
    expect(rangeLabelFor('now-6h', 'now', NOW, { degraded: true, showsPoints: true })).toBe('Last 6 hours')
  })
  it('says nothing to a member', () => {
    expect(rangeLabelFor('now-30d', 'now', NOW, { degraded: false, showsPoints: true })).toBe('Last 30 days')
  })
  it('falls back to the plain label with no options', () => {
    expect(rangeLabelFor('now-30d', 'now', NOW)).toBe('Last 30 days')
  })
})

// #440 follow-up: "N cells (capped)" under a range button reading "All time" is
// a contradiction the reader cannot resolve — and the truncation is not
// arbitrary, so a date is both honest and useful.
describe('coverageLabel', () => {
  const NOW = Date.parse('2026-08-24T20:00:00Z')
  const from = '2026-08-12T09:14:00Z'

  it('says nothing extra when the answer is complete', () => {
    // The range button already stated the span; repeating it would make the
    // common case noisier to fix the rare one.
    expect(coverageLabel(72, 'cells', { truncated: false }, NOW)).toBe('72 cells')
    expect(coverageLabel(0, 'points', {}, NOW)).toBe('0 points')
  })

  it('reports how far back a truncated answer reaches', () => {
    const label = coverageLabel(72, 'cells', { truncated: true, coversFrom: from }, NOW)
    expect(label).toMatch(/^72 cells · since 2026-08-12 \d\d:\d\d$/)
  })

  it('falls back to the old warning when truncated with no date', () => {
    // Something is missing and we cannot say from when — that is still better
    // served by a warning than by a claim with a blank in it.
    expect(coverageLabel(72, 'cells', { truncated: true }, NOW)).toBe('72 cells (capped)')
    expect(coverageLabel(72, 'cells', { truncated: true, coversFrom: 'not a date' }, NOW))
      .toBe('72 cells · since not a date')
  })
})

describe('coverageTitle', () => {
  const NOW = Date.parse('2026-08-24T20:00:00Z')
  it('is empty unless something was left out', () => {
    expect(coverageTitle(50000, { truncated: false }, NOW)).toBe('')
  })
  it('names the cap and the date, with a thousands separator', () => {
    const t = coverageTitle(50000, { truncated: true, coversFrom: '2026-08-12T09:14:00Z' }, NOW)
    expect(t).toContain('50,000')
    expect(t).toContain('Older ones are not in this view')
  })
})

describe('oldestRxAt', () => {
  it('finds the earliest, whatever order the pages arrived in', () => {
    // fetchPointsPaged concatenates pages, so "the last element" is not a
    // property this may rest on.
    expect(oldestRxAt([
      { rx_at: '2026-08-20T10:00:00Z' },
      { rx_at: '2026-08-12T09:14:00Z' },
      { rx_at: '2026-08-24T19:00:00Z' },
    ])).toBe('2026-08-12T09:14:00Z')
  })
  it('skips rows with no timestamp rather than answering with one', () => {
    expect(oldestRxAt([{ rx_at: '' }, null, {}, { rx_at: '2026-08-20T10:00:00Z' }]))
      .toBe('2026-08-20T10:00:00Z')
  })
  it('answers empty for nothing at all', () => {
    for (const empty of [[], null, undefined]) expect(oldestRxAt(empty)).toBe('')
  })
})
