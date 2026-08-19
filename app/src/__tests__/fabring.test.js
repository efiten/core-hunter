import { describe, it, expect } from 'vitest'
import { ringSegments, fabRingSvg } from '../fabring.js'

describe('ringSegments', () => {
  it('returns one entry per state', () => {
    expect(ringSegments(0, 3)).toHaveLength(3)
    expect(ringSegments(1, 4)).toHaveLength(4)
  })
  it('fills from the first segment through the current one, inclusive', () => {
    const segs = ringSegments(2, 4)
    expect(segs.map((s) => s.filled)).toEqual([true, true, true, false])
  })
  it('fills only the first segment when current is 0', () => {
    const segs = ringSegments(0, 3)
    expect(segs.map((s) => s.filled)).toEqual([true, false, false])
  })
  it('fills every segment when current is the last index', () => {
    const segs = ringSegments(3, 4)
    expect(segs.every((s) => s.filled)).toBe(true)
  })
  it('gives every segment the same dasharray (equal-length segments)', () => {
    const segs = ringSegments(1, 5)
    const arcs = new Set(segs.map((s) => s.dasharray))
    expect(arcs.size).toBe(1)
  })
  it('spaces segments apart with a distinct dashoffset each', () => {
    const segs = ringSegments(0, 4)
    const offsets = new Set(segs.map((s) => s.dashoffset))
    expect(offsets.size).toBe(4)
  })
  it('returns nothing for fewer than 2 states — a plain toggle needs no ring', () => {
    expect(ringSegments(0, 1)).toEqual([])
    expect(ringSegments(0, 0)).toEqual([])
  })
})

// Off is not a progress position (#373). The ring is shared by three FABs and
// only the sound one has an off state, so "current === 0 means empty" would be
// wrong for the other two: the compass's `following` and the view FAB's
// `points 2D` are both on at index 0 and their rings are correct as they are.
// Hence an opt-in offIndex rather than a rule about index 0.
describe('ringSegments — an off state fills nothing', () => {
  it('mutes every segment when current is the off index', () => {
    const segs = ringSegments(0, 3, { offIndex: 0 })
    expect(segs.map((s) => s.filled)).toEqual([false, false, false])
  })
  it('fills normally at every other index, so only off is special-cased', () => {
    expect(ringSegments(1, 3, { offIndex: 0 }).map((s) => s.filled)).toEqual([true, true, false])
    expect(ringSegments(2, 3, { offIndex: 0 }).map((s) => s.filled)).toEqual([true, true, true])
  })
  it('honours an off index that is not 0, so the rule is the argument and not the position', () => {
    expect(ringSegments(2, 3, { offIndex: 2 }).map((s) => s.filled)).toEqual([false, false, false])
    expect(ringSegments(0, 3, { offIndex: 2 }).map((s) => s.filled)).toEqual([true, false, false])
  })
  it('leaves geometry untouched — only the fill decision changes', () => {
    const on = ringSegments(0, 3)
    const off = ringSegments(0, 3, { offIndex: 0 })
    expect(off.map((s) => [s.index, s.dasharray, s.dashoffset]))
      .toEqual(on.map((s) => [s.index, s.dasharray, s.dashoffset]))
  })
  it('is unchanged for the callers that pass no off index', () => {
    expect(ringSegments(0, 3).map((s) => s.filled)).toEqual([true, false, false])
    expect(ringSegments(0, 3, {}).map((s) => s.filled)).toEqual([true, false, false])
  })
})

describe('fabRingSvg', () => {
  it('renders one circle per segment', () => {
    const svg = fabRingSvg(1, 3)
    expect((svg.match(/<circle/g) || []).length).toBe(3)
  })
  it('colors filled segments with the accent token, others muted', () => {
    const svg = fabRingSvg(0, 2)
    expect(svg).toContain('var(--ch-accent)')
    expect(svg).toContain('var(--ch-muted)')
  })
  it('renders nothing for a 2-state-or-fewer... i.e. single-state input', () => {
    expect(fabRingSvg(0, 1)).toBe('')
  })
  it('uses no accent at all in the off state, so nothing reads as "1 of 3 active"', () => {
    const svg = fabRingSvg(0, 3, { offIndex: 0 })
    expect(svg).not.toContain('var(--ch-accent)')
    expect((svg.match(/var\(--ch-muted\)/g) || []).length).toBe(3)
  })
  it('draws the same ring as before for the compass and view FABs', () => {
    // Those two call sites pass no options, and index 0 is an on state for
    // both. Byte-identical output is the acceptance criterion in #373.
    expect(fabRingSvg(0, 3)).toBe(fabRingSvg(0, 3, {}))
    expect(fabRingSvg(0, 3)).toContain('var(--ch-accent)')
  })
})
