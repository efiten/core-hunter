import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nodePosNotice, nodePosKeyText, registryKnownEmpty, NODEPOS_EMPTY_TEXT } from '../nodeposnotice.js'

// #662: the node-position layer writes nothing over the map about what a
// position is. The ▲ and ● say what they are in the popup's glyph line, and
// the statement that positions are inferred lives in the splash and About.
// What is left on this surface is the line saying why nothing could be drawn,
// and that stays for as long as the state lasts (#307, docs/design-system.md).
describe('nodePosNotice', () => {
  it('returns only the empty-registry explanation, never a note', () => {
    expect(nodePosNotice({ on: true, registryEmpty: false })).toEqual({ key: false })
    expect(nodePosNotice({ on: true, registryEmpty: true })).toEqual({ key: true })
    // ...and only while the layer is on.
    expect(nodePosNotice({ on: false, registryEmpty: true })).toEqual({ key: false })
  })

  it('defaults to showing nothing when called with no argument', () => {
    expect(nodePosNotice()).toEqual({ key: false })
  })
})

// #661 made the registry load twice: at start-up and again on connect, when the
// companion's SF is known. "Empty" is only a fact once a load has finished and
// no other one is running, or a retry that may still answer reads as a failure
// (#307: until then saying nothing is the honest answer).
describe('registryKnownEmpty', () => {
  it('is false for a registry that answered with nodes', () => {
    expect(registryKnownEmpty({ attempted: true, loading: false, count: 12 })).toBe(false)
  })

  it('is true once a finished load found nothing and none is running', () => {
    expect(registryKnownEmpty({ attempted: true, loading: false, count: 0 })).toBe(true)
  })

  it('is false before any load has finished', () => {
    expect(registryKnownEmpty({ attempted: false, loading: true, count: 0 })).toBe(false)
    expect(registryKnownEmpty({ attempted: false, loading: false, count: 0 })).toBe(false)
    expect(registryKnownEmpty()).toBe(false)
  })

  // The start-up load failed, the connect retry is still out: the old count
  // of 0 is no longer the answer.
  it('is false while a retry after a failed load is in flight', () => {
    expect(registryKnownEmpty({ attempted: true, loading: true, count: 0 })).toBe(false)
  })

  // A config without resolvers, or a config.json that did not load, leaves
  // nothing to ask, so no load ever runs. Nothing can be drawn, and that is
  // known from the start.
  it('is true with no resolver configured, before any load', () => {
    expect(registryKnownEmpty({ attempted: false, loading: false, count: 0, resolvers: 0 })).toBe(true)
    expect(registryKnownEmpty({ attempted: false, loading: false, count: 0, resolvers: 2 })).toBe(false)
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

// #662 removed #nodepos-note, which was the layer's live region. The line that
// is left takes that role over, or a screen reader stops hearing why nothing
// is drawn. That is markup, so it is pinned against the file, the way
// splash.test.js pins the FAB offsets.
describe('the key line keeps the live region (#662)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  it('#nodepos-key is a status region', () => {
    const tag = html.match(/<[^>]*\bid="nodepos-key"[^>]*>/)
    expect(tag, 'index.html has #nodepos-key').toBeTruthy()
    expect(tag[0]).toMatch(/\brole="status"/)
  })

  it('#nodepos-note is gone', () => {
    expect(html).not.toMatch(/id="nodepos-note"/)
  })
})
