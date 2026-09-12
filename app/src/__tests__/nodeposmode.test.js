import { describe, it, expect } from 'vitest'
import { NODEPOS_MODES, NODEPOS_LABELS, nextNodePosMode, parseNodePosMode } from '../nodeposmode.js'

// #603: the node-positions FAB has three stops, off / positions / positions
// + reach, cycled like the sound FAB, with the ring showing the stop.
describe('nextNodePosMode', () => {
  it('cycles off -> positions -> reach -> off', () => {
    expect(nextNodePosMode('off')).toBe('positions')
    expect(nextNodePosMode('positions')).toBe('reach')
    expect(nextNodePosMode('reach')).toBe('off')
  })
  it('treats an unknown mode as before the first, so the next tap lands on positions', () => {
    expect(nextNodePosMode(undefined)).toBe('positions')
    expect(nextNodePosMode('bogus')).toBe('positions')
  })
})

describe('parseNodePosMode', () => {
  it('reads a stored mode back and falls to off for anything else', () => {
    expect(parseNodePosMode('reach')).toBe('reach')
    expect(parseNodePosMode('positions')).toBe('positions')
    expect(parseNodePosMode(null)).toBe('off')
    expect(parseNodePosMode('1')).toBe('off')
  })
})

describe('NODEPOS_LABELS', () => {
  it('names every mode in the rail grammar, "Name: state"', () => {
    for (const m of NODEPOS_MODES) expect(NODEPOS_LABELS[m]).toMatch(/^Node positions: /)
  })
})
