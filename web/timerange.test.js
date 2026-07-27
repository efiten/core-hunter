import { describe, it, expect } from 'vitest'
import {
  isTimeToken, resolveToken, resolveTimeValue,
  QUICK_RANGES, matchQuickRange, rangeLabel, absoluteShareUrl,
  toLocalInput, boundFromField,
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
