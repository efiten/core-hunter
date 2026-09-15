import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nodePosNotice, nodePosKeyText, NODEPOS_EMPTY_TEXT } from '../nodeposnotice.js'

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
