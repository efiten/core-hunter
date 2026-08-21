import { describe, it, expect } from 'vitest'
import {
  nodePosPresentation, nodePosKeyText, registryStatusFor,
  NODEPOS_KEY_TEXT, NODEPOS_EMPTY_TEXT, NODEPOS_GUEST_TEXT, NODEPOS_UNCONFIGURED_TEXT,
  NODEPOS_UNAVAILABLE_TEXT, NODEPOS_NONE_IN_VIEW_TEXT, NODEPOS_STALE_SUFFIX,
} from './nodeposnotice.js'

const on = (over) => nodePosPresentation({ on: true, ...over })

describe('nodePosPresentation — every way to draw nothing says which one it was', () => {
  it('names the glyphs, and only then shows the disclaimer', () => {
    expect(on({ registry: { status: 'ok' }, drawn: 3 })).toEqual({ note: true, key: NODEPOS_KEY_TEXT })
  })

  it('gives each empty state its own line', () => {
    // The point of #376: these four used to be one silent empty layer.
    const key = (over) => on(over).key
    expect(key({ registry: { status: 'ok' }, drawn: 0 })).toBe(NODEPOS_NONE_IN_VIEW_TEXT)
    expect(key({ registry: { status: 'empty' } })).toBe(NODEPOS_EMPTY_TEXT)
    expect(key({ registry: { status: 'not_configured' } })).toBe(NODEPOS_UNCONFIGURED_TEXT)
    expect(key({ registry: { status: 'unavailable' } })).toBe(NODEPOS_UNAVAILABLE_TEXT)
    expect(new Set([NODEPOS_NONE_IN_VIEW_TEXT, NODEPOS_EMPTY_TEXT, NODEPOS_UNCONFIGURED_TEXT,
      NODEPOS_UNAVAILABLE_TEXT, NODEPOS_GUEST_TEXT]).size).toBe(5)
  })

  it('never shows the disclaimer without markers behind it', () => {
    // It asserts that advertised positions are on screen. With none, it reads
    // as "the layer works and the area is empty" — the original defect.
    for (const registry of [null, { status: 'ok' }, { status: 'empty' }, { status: 'not_configured' },
      { status: 'unavailable' }, { status: 'forbidden' }]) {
      expect(on({ registry, drawn: 0 }).note).toBe(false)
    }
    expect(on({ member: false, registry: { status: 'ok' }, drawn: 9 }).note).toBe(false)
  })

  it('treats a failed fetch as unreachable, not as an empty registry', () => {
    // null is "we never got an answer". Saying the registry holds nothing
    // would be a claim about data we did not receive.
    expect(on({ registry: null }).key).toBe(NODEPOS_UNAVAILABLE_TEXT)
    expect(on({ registry: { status: 'weird-new-code' } }).key).toBe(NODEPOS_UNAVAILABLE_TEXT)
  })

  it('names the role before anything about the registry', () => {
    // Below member the server strips positions, so an empty layer is explained
    // by the account, whatever the registry would have said.
    expect(on({ member: false, registry: { status: 'empty' } }).key).toBe(NODEPOS_GUEST_TEXT)
    expect(on({ registry: { status: 'forbidden' } }).key).toBe(NODEPOS_GUEST_TEXT)
  })

  it('marks a stale registry, on both of the states that drew from one', () => {
    expect(on({ registry: { status: 'ok', stale: true }, drawn: 2 }).key)
      .toBe(NODEPOS_KEY_TEXT + NODEPOS_STALE_SUFFIX)
    expect(on({ registry: { status: 'ok', stale: true }, drawn: 0 }).key)
      .toBe(NODEPOS_NONE_IN_VIEW_TEXT + NODEPOS_STALE_SUFFIX)
    // Not on a state that drew from no registry at all.
    expect(on({ registry: { status: 'unavailable', stale: true } }).key).toBe(NODEPOS_UNAVAILABLE_TEXT)
  })

  it('says nothing at all while the layer is off', () => {
    expect(nodePosPresentation({ on: false, registry: { status: 'ok' }, drawn: 5 })).toEqual({ note: false, key: '' })
    expect(nodePosPresentation()).toEqual({ note: false, key: '' })
  })
})

describe('registryStatusFor — the server distinguishes these deliberately', () => {
  it('maps each server answer to its own status', () => {
    expect(registryStatusFor(200, undefined)).toBe('ok')
    expect(registryStatusFor(403, 'forbidden')).toBe('forbidden')
    expect(registryStatusFor(503, 'registry_not_configured')).toBe('not_configured')
    expect(registryStatusFor(503, 'registry_empty')).toBe('empty')
    expect(registryStatusFor(503, 'registry_unavailable')).toBe('unavailable')
  })

  it('falls back to unreachable for anything it does not know', () => {
    // A 500, a proxy's HTML error page, a bad_bbox: all "no registry answer",
    // none of them a claim that the registry is empty.
    expect(registryStatusFor(500, undefined)).toBe('unavailable')
    expect(registryStatusFor(400, 'bad_bbox')).toBe('unavailable')
    expect(registryStatusFor(502, 'something-new')).toBe('unavailable')
  })
})

describe('nodePosKeyText — kept in step with the app copy', () => {
  it('chooses between the two shared lines', () => {
    expect(nodePosKeyText({ registryEmpty: false })).toBe(NODEPOS_KEY_TEXT)
    expect(nodePosKeyText({ registryEmpty: true })).toBe(NODEPOS_EMPTY_TEXT)
    expect(nodePosKeyText()).toBe(NODEPOS_KEY_TEXT)
  })
})

// #426: the disclaimer block is a quarter of a phone screen, over the part of
// the map being read. On a wide screen the same corner costs nothing, so the
// glance is scoped to narrow viewports rather than applied to web as a whole.
describe('nodePosPresentation — the prose is a glance on a narrow screen', () => {
  const drawn = { on: true, member: true, registry: { status: 'ok', stale: false }, drawn: 3 }

  it('keeps the prose on a wide screen however long the layer is on', () => {
    expect(nodePosPresentation({ ...drawn, narrow: false, glanceExpired: true }).note).toBe(true)
    expect(nodePosPresentation({ ...drawn, narrow: false, glanceExpired: false }).note).toBe(true)
  })

  it('shows it on a narrow screen and then lets it go', () => {
    expect(nodePosPresentation({ ...drawn, narrow: true, glanceExpired: false }).note).toBe(true)
    expect(nodePosPresentation({ ...drawn, narrow: true, glanceExpired: true }).note).toBe(false)
  })

  // §7: the key is the half that must stay, so the glance must not reach it.
  it('never takes the key with it', () => {
    for (const glanceExpired of [true, false]) {
      const r = nodePosPresentation({ ...drawn, narrow: true, glanceExpired })
      expect(r.key, String(glanceExpired)).toContain('▲')
    }
  })

  // Every other branch already answers note:false, so the glance must not turn
  // one of them back on -- a guest or an unreachable registry has no prose to
  // show in the first place.
  it('cannot switch the prose on for a state that has none', () => {
    const off = [
      { on: false },
      { on: true, member: false },
      { on: true, registry: { status: 'empty' } },
      { on: true, registry: { status: 'unavailable' } },
      { on: true, registry: { status: 'ok' }, drawn: 0 },
    ]
    for (const base of off) {
      expect(nodePosPresentation({ ...base, narrow: true, glanceExpired: false }).note,
        JSON.stringify(base)).toBe(false)
    }
  })

  it('defaults to no glance, so a caller that does not opt in is unaffected', () => {
    expect(nodePosPresentation(drawn).note).toBe(true)
  })
})
