import { describe, it, expect } from 'vitest'
import { appendTrailPoint } from '../trail.js'

describe('appendTrailPoint', () => {
  it('appends the first fix to an empty trail', () => {
    expect(appendTrailPoint([], 51, 4)).toEqual([[51, 4]])
  })
  it('appends a fix that moved beyond the threshold', () => {
    const trail = [[51, 4]]
    const next = appendTrailPoint(trail, 51.001, 4) // ~111 m north
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual([51.001, 4])
  })
  it('skips a fix that has not moved far enough (GPS jitter), returning the same array', () => {
    const trail = [[51, 4]]
    const next = appendTrailPoint(trail, 51.00001, 4, 5) // ~1 m < 5 m
    expect(next).toBe(trail) // identity — no redraw needed
  })
  it('ignores null/NaN coordinates', () => {
    const trail = [[51, 4]]
    expect(appendTrailPoint(trail, null, 4)).toBe(trail)
    expect(appendTrailPoint(trail, 51, NaN)).toBe(trail)
  })
})
