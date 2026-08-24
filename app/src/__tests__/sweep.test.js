import { describe, it, expect } from 'vitest'
import { RETRY_BACKOFF_MS, retryBackoffFor, isSweepDue, nextSweepBatch, noteAsk } from '../sweep.js'

const T0 = Date.parse('2026-08-24T12:00:00Z')
const ctx = (o = {}) => ({ heardAt: new Map(), attempts: new Map(), lastAskedAt: new Map(), cursor: 0, now: T0, ...o })

describe('retryBackoffFor', () => {
  it('lets a first ask through and grows the wait for each unanswered one', () => {
    expect(retryBackoffFor(0)).toBe(0)
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      expect(retryBackoffFor(i)).toBeGreaterThan(retryBackoffFor(i - 1))
    }
  })
  it('holds at the last step rather than growing without bound', () => {
    const last = RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
    expect(retryBackoffFor(RETRY_BACKOFF_MS.length)).toBe(last)
    expect(retryBackoffFor(99)).toBe(last)
  })
})

// Being heard again is the in-range signal, and it costs nothing to read: a node
// that just transmitted is a node whose reply we can expect. Backing off on the
// clock alone would keep a repeater silent for ten minutes after we drove back
// into its range.
describe('isSweepDue', () => {
  it('asks a node it has never asked', () => {
    expect(isSweepDue('ab', ctx())).toBe(true)
  })
  it('waits out the backoff for one that has not been heard since the ask', () => {
    const c = ctx({ lastAskedAt: new Map([['ab', T0]]), attempts: new Map([['ab', 1]]), now: T0 + retryBackoffFor(1) - 1 })
    expect(isSweepDue('ab', c)).toBe(false)
    expect(isSweepDue('ab', { ...c, now: T0 + retryBackoffFor(1) })).toBe(true)
  })
  it('asks again immediately once the node has been heard since the ask', () => {
    const c = ctx({
      lastAskedAt: new Map([['ab', T0]]),
      attempts: new Map([['ab', 3]]),
      heardAt: new Map([['ab', T0 + 1000]]),
      now: T0 + 2000,
    })
    expect(isSweepDue('ab', c)).toBe(true)
  })
  it('does not count a reception from before the ask as an answer to it', () => {
    const c = ctx({
      lastAskedAt: new Map([['ab', T0]]),
      attempts: new Map([['ab', 1]]),
      heardAt: new Map([['ab', T0 - 1000]]),
      now: T0 + 1000,
    })
    expect(isSweepDue('ab', c)).toBe(false)
  })
})

describe('noteAsk', () => {
  it('counts consecutive asks that went unheard', () => {
    let c = ctx()
    c = { ...c, ...noteAsk('ab', c, T0) }
    expect(c.attempts.get('ab')).toBe(1)
    c = { ...c, ...noteAsk('ab', c, T0 + 60000) }
    expect(c.attempts.get('ab')).toBe(2)
  })
  it('starts the count over once the node has been heard since the last ask', () => {
    let c = ctx()
    c = { ...c, ...noteAsk('ab', c, T0) }
    c = { ...c, ...noteAsk('ab', c, T0 + 60000) }
    c.heardAt.set('ab', T0 + 61000)
    c = { ...c, ...noteAsk('ab', c, T0 + 62000) }
    expect(c.attempts.get('ab')).toBe(1)
  })
  it('records when the ask went out', () => {
    const c = ctx()
    expect(noteAsk('ab', c, T0).lastAskedAt.get('ab')).toBe(T0)
  })
})

describe('nextSweepBatch', () => {
  const five = ['aa', 'bb', 'cc', 'dd', 'ee']

  it('sweeps several distinct nodes per cycle, in rotation order', () => {
    const batch = nextSweepBatch(five, ctx({ cursor: 0 }), 3)
    expect(batch).toEqual(['aa', 'bb', 'cc'])
    expect(new Set(batch).size).toBe(3)
  })
  it('carries on where the previous cycle stopped, wrapping round', () => {
    expect(nextSweepBatch(five, ctx({ cursor: 4 }), 3)).toEqual(['ee', 'aa', 'bb'])
  })
  it('never asks one node twice to fill the batch', () => {
    const batch = nextSweepBatch(['aa', 'bb'], ctx(), 4)
    expect(batch).toEqual(['aa', 'bb'])
  })
  it('returns nothing when nothing is due', () => {
    const c = ctx({ lastAskedAt: new Map([['aa', T0]]), attempts: new Map([['aa', 2]]), now: T0 + 1000 })
    expect(nextSweepBatch(['aa'], c, 4)).toEqual([])
  })
  it('prefers nodes that answered over ones that have been silent', () => {
    const c = ctx({
      lastAskedAt: new Map([['aa', T0 - 5000], ['bb', T0 - 5000]]),
      attempts: new Map([['aa', 1], ['bb', 2]]),
      heardAt: new Map([['aa', T0 - 1000]]),
      now: T0 + retryBackoffFor(2),
    })
    expect(nextSweepBatch(['aa', 'bb'], c, 2)).toEqual(['aa'])
  })
  it('still reaches a silent node once nothing else is due', () => {
    const c = ctx({
      lastAskedAt: new Map([['bb', T0 - 5000]]),
      attempts: new Map([['bb', 2]]),
      now: T0 + retryBackoffFor(2),
    })
    expect(nextSweepBatch(['bb'], c, 2)).toEqual(['bb'])
  })
  it('returns an empty batch when there is nothing to ask at all', () => {
    expect(nextSweepBatch([], ctx(), 4)).toEqual([])
  })
  it('leaves out a node inside its backoff while sweeping the rest', () => {
    const c = ctx({ lastAskedAt: new Map([['bb', T0]]), attempts: new Map([['bb', 2]]), now: T0 + 1000 })
    expect(nextSweepBatch(five, c, 5)).not.toContain('bb')
  })
})
