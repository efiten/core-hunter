import { describe, it, expect } from 'vitest'
import { nodePosNotice, nodePosKeyText, NODEPOS_KEY_TEXT, NODEPOS_EMPTY_TEXT, NODEPOS_GLANCE_MS } from '../nodeposnotice.js'

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

// #307: the layer only draws a node some resolver's bulk /positions endpoint
// actually returned. If every resolver 404s, errors, or simply holds no
// positions, the layer draws nothing — and "worked, nothing to show" looked
// exactly like "failed silently". The key line says which it was.
describe('nodePosKeyText — what the permanent line says', () => {
  it('is the glyph key when there is registry data to draw', () => {
    expect(nodePosKeyText({ registryEmpty: false })).toBe(NODEPOS_KEY_TEXT)
    expect(nodePosKeyText()).toBe(NODEPOS_KEY_TEXT)
  })

  it('says the registry is empty when there is nothing to draw', () => {
    expect(nodePosKeyText({ registryEmpty: true })).toBe(NODEPOS_EMPTY_TEXT)
  })

  // Explaining ▲ and ● while neither is on screen is worse than saying
  // nothing: it implies the layer is working and the area is simply empty.
  it('does not explain glyphs that cannot be on screen', () => {
    expect(NODEPOS_EMPTY_TEXT).not.toContain('▲')
    expect(NODEPOS_EMPTY_TEXT).not.toContain('●')
  })

  it('names the registry as the source of the emptiness, not the map view', () => {
    expect(NODEPOS_EMPTY_TEXT).toMatch(/registry|resolver/i)
  })

  it('always answers with a non-empty string, so the layer is never unlabelled', () => {
    for (const registryEmpty of [true, false, undefined]) {
      expect(nodePosKeyText({ registryEmpty })).toBeTruthy()
    }
  })
})
