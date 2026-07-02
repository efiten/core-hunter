import { describe, it, expect } from 'vitest'
import { gateDecision } from '../writegate.js'

const rec = { name: 'A', lat: 1.0, lon: 2.0 }

describe('gateDecision', () => {
  it('writes when the pubkey is new (no prev)', () => {
    expect(gateDecision(undefined, rec)).toBe(true)
  })
  it('skips when nothing changed', () => {
    expect(gateDecision({ name: 'A', lat: 1.0, lon: 2.0 }, rec)).toBe(false)
  })
  it('writes when the name changed', () => {
    expect(gateDecision({ name: 'B', lat: 1.0, lon: 2.0 }, rec)).toBe(true)
  })
  it('writes when the location changed', () => {
    expect(gateDecision({ name: 'A', lat: 9.9, lon: 2.0 }, rec)).toBe(true)
  })
  it('skips when both prev and rec have null location and same name', () => {
    expect(gateDecision({ name: 'A', lat: null, lon: null }, { name: 'A', lat: null, lon: null })).toBe(false)
  })
})
