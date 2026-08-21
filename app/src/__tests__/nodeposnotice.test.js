import { describe, it, expect } from 'vitest'
import { nodePosNotice, nodePosKeyText, NODEPOS_KEY_TEXT, NODEPOS_EMPTY_TEXT, NODEPOS_GLANCE_MS } from '../nodeposnotice.js'

// AGENTS.md §7. The rule these tests defend, as amended by #413: while the
// node-position layer is drawn, what ▲ and ● mean is shown when the layer is
// switched on and stays reachable afterwards — in the marker popups, which
// carry the disclaimer in .np-caveat — rather than displayed permanently.
//
// It used to be permanent, and these tests said so in as many words. That was
// not a bug: #306 had already pushed both notices out of the HUD and into
// #toast-stack, and permanence was the deliberate half of that. #322 then made
// the receptions ticker large enough to read at a glance while driving, and it
// occupies the same band — so the permanent key cancelled out the thing #322
// existed to deliver, for anyone with the layer on. See
// docs/2026-08-21-nodepos-key-glance.md.
describe('nodePosNotice — the §7 guarantee, as amended by #413', () => {
  it('shows the key when the layer is switched on', () => {
    expect(nodePosNotice({ on: true, glanceExpired: false }).key).toBe(true)
  })

  it('lets the key go once the glance has expired, clearing the ticker band', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true }).key).toBe(false)
  })

  it('shows nothing at all while the layer is off', () => {
    expect(nodePosNotice({ on: false, glanceExpired: false })).toEqual({ note: false, key: false })
    expect(nodePosNotice({ on: false, glanceExpired: true })).toEqual({ note: false, key: false })
  })

  // The one line that does NOT fade, and the reason the two surfaces still
  // differ. "No positions from the registry" is not a legend for glyphs on
  // screen — there are none — it is the explanation for why the map is empty.
  // Fading it puts #307's bug back: an empty registry and an empty area look
  // identical again to anyone who looks a few seconds later.
  it('keeps the empty-registry line up, because it explains an absence', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true, registryEmpty: true }).key).toBe(true)
    expect(nodePosNotice({ on: true, glanceExpired: false, registryEmpty: true }).key).toBe(true)
    // ...and only while the layer is on.
    expect(nodePosNotice({ on: false, glanceExpired: true, registryEmpty: true }).key).toBe(false)
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

  it('hides both surfaces once the glance has expired', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true })).toEqual({ note: false, key: false })
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
