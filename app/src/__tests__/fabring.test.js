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
})
