import { describe, it, expect } from 'vitest'
import { rxView, rxActiveIndex, rxFade, rxLineHeight, senderText } from '../receptionlog.js'

const rec = (o) => ({ id: 1, rx_at: '2026-06-29T10:00:00Z', ...o })

// The ticker prints sender_label straight into the row. meshpacket.js carries
// a 1-byte hash AS that label, so without a guard "77" appears in the same
// place, same style, as a resolved name -- the exact confusion hudsender.js
// was given the # mark to prevent.
describe('senderText — an id is never dressed as a name', () => {
  it('marks a 1-byte path hash', () => {
    expect(senderText({ sender_kind: 'path_hash', sender_id: '77', sender_label: '77' })).toBe('#77')
  })
  it('marks a 1-byte direct hash', () => {
    expect(senderText({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' })).toBe('#4a')
  })
  it('ignores a hash-kind label even when it looks like a real name', () => {
    expect(senderText({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: 'Repeater-Zuid' })).toBe('#4a')
  })
  it('prints a resolved name for every other kind', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: 'repeater-3' })).toBe('repeater-3')
  })
  it('falls back to the id, then to a dash', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: '' })).toBe('a1b2f3')
    expect(senderText({ sender_kind: 'relay', sender_id: null, sender_label: null })).toBe('—')
  })
})

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
    const out = rxView(many, many, 'filtered', 3)
    expect(out.map((r) => r.id)).toEqual([7, 8, 9])
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
    expect(rxActiveIndex(50, 20, 10)).toBe(3) // 2.5 rounds to 3 (banker-free Math.round)
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
    expect(rxFade(-9)).toBe(0)
  })
  it('fades faster over ~3 lines below (positive d)', () => {
    expect(rxFade(1)).toBeCloseTo(2 / 3)
    expect(rxFade(3)).toBe(0)
    expect(rxFade(5)).toBe(0)
  })
})

// rxLineHeight (#322): the row height now lives in CSS as --ch-rx-line-h and
// the component reads it, instead of both sides hardcoding 20 and drifting.
// The fallback matters: if the variable is missing (an old cached stylesheet,
// a test DOM with no styles) the playhead maths must still use the value the
// stylesheet ships, not 0 — a 0 here divides scrollTop by zero in
// rxActiveIndex and pins every row to the lane.
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
