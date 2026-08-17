import { describe, it, expect } from 'vitest'
import { calloutPosition, unionRect, avoidOverlap } from '../calloutPosition.js'

const rect = (o) => ({ left: 0, top: 0, right: 0, bottom: 0, ...o })
const vp = { width: 400, height: 800 }
const size = { width: 150, height: 60 }

describe('calloutPosition', () => {
  it('places below and left-aligned to the target by default', () => {
    const target = rect({ left: 12, top: 40, right: 120, bottom: 70 })
    expect(calloutPosition(target, vp, size)).toEqual({ top: 80, left: 12 })
  })
  it('places above the target when side is "above"', () => {
    const target = rect({ left: 12, top: 700, right: 120, bottom: 730 })
    expect(calloutPosition(target, vp, size, { side: 'above' })).toEqual({ top: 630, left: 12 })
  })
  it('right-aligns to the target when align is "right"', () => {
    const target = rect({ left: 300, top: 40, right: 388, bottom: 70 })
    expect(calloutPosition(target, vp, size, { align: 'right' })).toEqual({ top: 80, left: 238 })
  })
  it('places to the left of the target when side is "left"', () => {
    const target = rect({ left: 350, top: 400, right: 390, bottom: 440 })
    expect(calloutPosition(target, vp, size, { side: 'left' })).toEqual({ top: 400, left: 190 })
  })
  it('clamps horizontally so the callout never runs off the right edge', () => {
    const target = rect({ left: 380, top: 40, right: 398, bottom: 70 })
    expect(calloutPosition(target, vp, size)).toEqual({ top: 80, left: 242 })
  })
  it('clamps to the margin so the callout never runs off the left edge', () => {
    const target = rect({ left: -50, top: 40, right: 10, bottom: 70 })
    expect(calloutPosition(target, vp, size)).toEqual({ top: 80, left: 8 })
  })
  it('clamps vertically so the callout never runs off the bottom edge', () => {
    const target = rect({ left: 12, top: 770, right: 120, bottom: 795 })
    expect(calloutPosition(target, vp, size)).toEqual({ top: 732, left: 12 })
  })
})

describe('unionRect', () => {
  it('returns the bounding box that encloses all given rects', () => {
    const rects = [
      rect({ left: 20, top: 10, right: 40, bottom: 30 }),
      rect({ left: 5, top: 50, right: 45, bottom: 90 }),
      rect({ left: 30, top: 5, right: 60, bottom: 20 }),
    ]
    expect(unionRect(rects)).toEqual({ left: 5, top: 5, right: 60, bottom: 90, width: 55, height: 85 })
  })
  it('handles a single rect', () => {
    expect(unionRect([rect({ left: 1, top: 2, right: 3, bottom: 4 })]))
      .toEqual({ left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2 })
  })
})

describe('avoidOverlap', () => {
  const viewport = { width: 1280, height: 800 }
  const box = (top, left, width = 200, height = 100) => ({ top, left, width, height })

  it('leaves a box that hits nothing where it was anchored', () => {
    expect(avoidOverlap(box(100, 0), [box(100, 400)], viewport)).toEqual({ top: 100, left: 0 })
  })

  it('drops a box below the one it would cover, keeping its horizontal anchor', () => {
    expect(avoidOverlap(box(100, 0), [box(80, 0)], viewport)).toEqual({ top: 188, left: 0 })
  })

  it('re-checks a box it has already passed — the move can create a new collision', () => {
    // Order matters: the far box (250) is checked first and missed, then the
    // near one (80) pushes the callout down INTO it. A single sweep stops at
    // 188, on top of the box it was supposed to avoid.
    expect(avoidOverlap(box(100, 0), [box(250, 0), box(80, 0)], viewport))
      .toEqual({ top: 358, left: 0 })
  })

  it('does not push a box off the bottom of the viewport', () => {
    expect(avoidOverlap(box(700, 0), [box(690, 0)], viewport).top).toBe(692)
  })

  it('ignores a box that only overlaps vertically, in another column', () => {
    expect(avoidOverlap(box(100, 0), [box(100, 250)], viewport)).toEqual({ top: 100, left: 0 })
  })
})
