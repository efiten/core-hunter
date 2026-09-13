import { describe, it, expect } from 'vitest'
import { nodePosNotice, nodePosKeyText, NODEPOS_EMPTY_TEXT, NODEPOS_GLANCE_MS,
  NODEPOS_ADVERT_CAVEAT, NODEPOS_ESTIMATE_CAVEAT } from '../nodeposnotice.js'

// AGENTS.md §7, as revised by #631. The rule these tests defend: while the
// node-position layer is drawn, what ▲ and ● mean lives in the marker popup,
// and nothing about the glyphs is written over the map.
//
// It has been through three rounds, and the reasoning is worth carrying rather
// than being rediscovered as a bug. #306 pushed both notices out of the HUD
// into #toast-stack, pinned to the top of the screen. #322 then made the
// receptions ticker large enough to read while driving, and it takes that same
// band, so a permanent key sat on the ticker for the whole session. #413 made
// the key a two-second glance instead. #631 asks the question one level up: if
// the popup is where a reader actually goes to find out what a marker is, a
// second copy over the map is not the requirement, it is clutter.
//
// What remains on screen is not a legend: a line saying nothing could be drawn
// explains an absence, and §7 keeps that for as long as the state lasts.
describe('nodePosNotice — the §7 guarantee, as revised by #631', () => {
  it('writes no glyph key over the map, however fresh the activation', () => {
    expect(nodePosNotice({ on: true, glanceExpired: false }).key).toBe(false)
    expect(nodePosNotice({ on: true, glanceExpired: true }).key).toBe(false)
  })

  it('shows nothing at all while the layer is off', () => {
    expect(nodePosNotice({ on: false, glanceExpired: false })).toEqual({ note: false, key: false })
    expect(nodePosNotice({ on: false, glanceExpired: true })).toEqual({ note: false, key: false })
  })

  // The one line that survives, and the reason the surface still exists.
  // "No positions from the registry" is not a legend for glyphs on screen —
  // there are none — it is the explanation for why the map is blank. Dropping
  // it puts #307's bug back: an empty registry and an empty area look
  // identical again.
  it('keeps the empty-registry line, because it explains an absence', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true, registryEmpty: true }).key).toBe(true)
    expect(nodePosNotice({ on: true, glanceExpired: false, registryEmpty: true }).key).toBe(true)
    // ...and only while the layer is on.
    expect(nodePosNotice({ on: false, glanceExpired: true, registryEmpty: true }).key).toBe(false)
  })

  // The glance never reached that line before #631 either, and must not start
  // now that it is the only thing the surface carries.
  it('never fades the line that explains an absence', () => {
    for (const glanceExpired of [true, false]) {
      expect(nodePosNotice({ on: true, glanceExpired, registryEmpty: true }).key, String(glanceExpired)).toBe(true)
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

// The position disclaimer itself is a separate sentence in §7 and is NOT what
// #631 removes: it is about the whole layer, not about which glyph is which.
describe('nodePosNotice — the prose glance is untouched', () => {
  it('shows the prose on activation', () => {
    expect(nodePosNotice({ on: true, glanceExpired: false }).note).toBe(true)
  })

  it('lets it go once the glance has expired', () => {
    expect(nodePosNotice({ on: true, glanceExpired: true }).note).toBe(false)
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

  it('keeps the glance short enough to be a glance', () => {
    expect(NODEPOS_GLANCE_MS).toBeGreaterThan(0)
    expect(NODEPOS_GLANCE_MS).toBeLessThanOrEqual(5000)
  })
})

// #631 moves the glyph meaning into the popup, so the popup has to carry all
// of it. It already named the two glyphs and disclaimed the advertised one;
// what it never said is the half the key did: that ● is inferred from radio,
// not a position the node reported or a GPS fix of it.
describe('the popup caveats — where the glyph meaning lives now', () => {
  it('attributes the advertised position to the operator, and calls it stale-able', () => {
    expect(NODEPOS_ADVERT_CAVEAT).toMatch(/operator/i)
    expect(NODEPOS_ADVERT_CAVEAT).toMatch(/stale/i)
  })

  it('says the estimate comes from radio measurements', () => {
    expect(NODEPOS_ESTIMATE_CAVEAT).toMatch(/rssi/i)
  })

  // The claim §7 exists to prevent, and the one the estimate is most likely to
  // be misread as.
  it('denies that the estimate is a GPS fix of the node', () => {
    expect(NODEPOS_ESTIMATE_CAVEAT).toMatch(/not gps|not from gps/i)
  })

  it('are two different sentences, so neither has to cover the other glyph', () => {
    expect(NODEPOS_ADVERT_CAVEAT).not.toBe(NODEPOS_ESTIMATE_CAVEAT)
  })
})

// #307: the layer only draws a node some resolver's bulk /positions endpoint
// actually returned. If every resolver 404s, errors, or simply holds no
// positions, the layer draws nothing — and "worked, nothing to show" looked
// exactly like "failed silently". This line says which it was.
describe('nodePosKeyText — the line that is left', () => {
  it('says the registry is empty when there is nothing to draw', () => {
    expect(nodePosKeyText({ registryEmpty: true })).toBe(NODEPOS_EMPTY_TEXT)
  })

  // With markers on screen there is nothing left to say here: the popup
  // answers what a glyph is, and a line repeating it over the map is what
  // #631 removed.
  it('says nothing at all when there are markers to explain', () => {
    expect(nodePosKeyText({ registryEmpty: false })).toBe('')
    expect(nodePosKeyText()).toBe('')
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
})
