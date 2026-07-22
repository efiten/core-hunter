import { describe, it, expect } from 'vitest'
import {
  isTimeToken, resolveToken, resolveTimeValue,
  QUICK_RANGES, matchQuickRange, rangeLabel, absoluteShareUrl,
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
