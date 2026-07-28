import { describe, it, expect } from 'vitest'
import { nodePosNotice, NODEPOS_KEY_TEXT, NODEPOS_GLANCE_MS } from '../nodeposnotice.js'

// AGENTS.md §7. The rule these tests exist to defend: while the node-position
// layer is drawn, something on screen must say that ▲ is an operator-reported
// position and ● is our RSSI inference. #306 asked for the prose to stop
// covering the HUD; that is a reason to fade the prose, not the guarantee.
// This lived in a code comment before, and a later PR deleted the comment.
describe('nodePosNotice — the §7 guarantee', () => {
  it('keeps the key on screen for as long as the layer is on', () => {
    expect(nodePosNotice({ on: true, glanceExpired: false }).key).toBe(true)
    expect(nodePosNotice({ on: true, glanceExpired: true }).key).toBe(true)
  })

  it('shows nothing at all while the layer is off', () => {
    expect(nodePosNotice({ on: false, glanceExpired: false })).toEqual({ note: false, key: false })
    expect(nodePosNotice({ on: false, glanceExpired: true })).toEqual({ note: false, key: false })
  })

  // The failure this is really guarding: someone adds a timer to the key too,
  // and the ▲/● semantics go unlabelled a few seconds into every session.
  it('never lets the key depend on the glance timer', () => {
    for (const glanceExpired of [true, false]) {
      expect(nodePosNotice({ on: true, glanceExpired }).key).toBe(nodePosNotice({ on: true }).key)
    }
  })

  it('is total — both surfaces answer with a boolean for every input', () => {
    for (const on of [true, false, undefined]) {
      for (const glanceExpired of [true, false, undefined]) {
        const r = nodePosNotice({ on, glanceExpired })
        expect(typeof r.note).toBe('boolean')
        expect(typeof r.key).toBe('boolean')
      }
    }
  })

  it('defaults to showing nothing when called with no argument', () => {
    expect(nodePosNotice()).toEqual({ note: false, key: false })
  })
})

describe('nodePosNotice — the glance', () => {
  it('shows the prose on activation', () => {
    expect(nodePosNotice({ on: true, glanceExpired: false }).note).toBe(true)
  })

  it('hides the prose once the glance has expired, leaving the key', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true })).toEqual({ note: false, key: true })
  })

  // "Every time the view freshly (re-)appears", not just the first time: the
  // function holds no state across activations, so an off→on cycle with a
  // reset timer is a fresh glance.
  it('has no memory of earlier activations', () => {
    const first = nodePosNotice({ on: true, glanceExpired: false })
    nodePosNotice({ on: true, glanceExpired: true })
    nodePosNotice({ on: false, glanceExpired: true })
    expect(nodePosNotice({ on: true, glanceExpired: false })).toEqual(first)
  })
})

describe('the key text', () => {
  it('names both glyphs and attributes each to its source', () => {
    expect(NODEPOS_KEY_TEXT).toContain('▲')
    expect(NODEPOS_KEY_TEXT).toContain('●')
    expect(NODEPOS_KEY_TEXT).toMatch(/operator/i)
    expect(NODEPOS_KEY_TEXT).toMatch(/rssi/i)
  })

  it('does not claim the estimate is a GPS fix of the target', () => {
    expect(NODEPOS_KEY_TEXT).not.toMatch(/gps track/i)
  })

  it('keeps the glance short enough to be a glance', () => {
    expect(NODEPOS_GLANCE_MS).toBeGreaterThan(0)
    expect(NODEPOS_GLANCE_MS).toBeLessThanOrEqual(5000)
  })
})
