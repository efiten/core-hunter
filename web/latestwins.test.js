import { describe, it, expect } from 'vitest'
import { latestWins } from './latestwins.js'

describe('latestWins — only the newest draw may paint', () => {
  it('lets a lone draw paint', () => {
    const isCurrent = latestWins()()
    expect(isCurrent()).toBe(true)
  })
  // A pan/zoom burst starts several overlapping draws; whichever responses
  // land, only the newest bbox's may reach the map.
  it('stops an earlier draw once a later one has started', () => {
    const start = latestWins()
    const first = start()
    const second = start()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })
  it('keeps the newest current no matter what order the draws finish in', () => {
    const start = latestWins()
    const a = start(), b = start(), c = start()
    expect([c(), b(), a()]).toEqual([true, false, false])
  })
  it('gives each guard its own sequence', () => {
    const one = latestWins(), two = latestWins()
    const oneFirst = one()
    two(); two()
    expect(oneFirst()).toBe(true)
  })
})
