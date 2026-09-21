import { describe, it, expect } from 'vitest'
import { pruneFloor, dotState } from '../brokers.js'

describe('pruneFloor — how far retention may delete (#554)', () => {
  it('stops at the broker that is furthest behind', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 120 }])).toBe(120)
  })

  it('holds everything while one broker has received nothing', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 0 }])).toBe(0)
  })

  // Nothing is owed to anyone, so age alone decides. Without this a hunter who
  // switched every broker off would keep every reception forever.
  it('lets age decide when no broker is on', () => {
    expect(pruneFloor([])).toBe(Infinity)
  })
})

describe('dotState — one dot for several brokers (#554)', () => {
  it('is on when every broker is connected', () => {
    expect(dotState([true, true])).toBe('on')
  })

  it('is partial when one is missing', () => {
    expect(dotState([true, false])).toBe('partial')
  })

  it('is off when none is connected, or none is on', () => {
    expect(dotState([false, false])).toBe('off')
    expect(dotState([])).toBe('off')
  })
})
