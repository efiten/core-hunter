import { describe, it, expect } from 'vitest'
import {
  nodePosPresentation, nodePosKeyText, registryStatusFor, nextNotice,
  NODEPOS_EMPTY_TEXT, NODEPOS_GUEST_TEXT, NODEPOS_UNCONFIGURED_TEXT,
  NODEPOS_UNAVAILABLE_TEXT, NODEPOS_NONE_IN_VIEW_TEXT, NODEPOS_STALE_TEXT,
  NODEPOS_SERVER_UNREACHABLE_TEXT, NODEPOS_GLANCE_MS,
} from './nodeposnotice.js'

const on = (over) => nodePosPresentation({ on: true, ...over })

describe('nodePosPresentation — every way to draw nothing says which one it was', () => {
  // #631 took the glyph key off the map, and #662 the note that repeated that
  // positions are inferred. Over a drawn layer the only line left is the one
  // that reports a state of the registry itself.
  it('says nothing over a drawn layer, only why a layer is empty or old', () => {
    expect(on({ registry: { status: 'ok' }, drawn: 3 })).toEqual({ key: '' })
    expect(on({ registry: { status: 'ok', stale: true }, drawn: 3 })).toEqual({ key: NODEPOS_STALE_TEXT })
    expect(on({ registry: { status: 'empty' } })).toEqual({ key: NODEPOS_EMPTY_TEXT })
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

  it('treats a failed fetch as unreachable, not as an empty registry', () => {
    // null is "we never got an answer". Saying the registry holds nothing
    // would be a claim about data we did not receive. Since #591 it also says
    // whose answer it did not get: the map server's, not the registry's.
    expect(on({ registry: null }).key).toBe(NODEPOS_SERVER_UNREACHABLE_TEXT)
    expect(on({ registry: { status: 'server_unreachable' } }).key).toBe(NODEPOS_SERVER_UNREACHABLE_TEXT)
    expect(on({ registry: { status: 'weird-new-code' } }).key).toBe(NODEPOS_UNAVAILABLE_TEXT)
    expect(NODEPOS_SERVER_UNREACHABLE_TEXT).not.toBe(NODEPOS_UNAVAILABLE_TEXT)
  })

  // #591: an outage is a glance, 3 s and gone, the layer's switch stays on.
  // The lines that explain a map with nothing on it stay, as #376 wanted:
  // since #604 an outage no longer leaves the map empty (the stars hang from
  // their estimates), while an unconfigured or empty registry still does.
  it('marks the two outages as a glance, and nothing else', () => {
    expect(on({ registry: { status: 'unavailable' } }).glance).toBe(true)
    expect(on({ registry: null }).glance).toBe(true)
    for (const over of [{ registry: { status: 'empty' } }, { registry: { status: 'not_configured' } },
      { registry: { status: 'forbidden' } }, { registry: { status: 'ok' }, drawn: 0 },
      { registry: { status: 'ok', stale: true }, drawn: 2 }, { reason: 'Log in.' }]) {
      expect(on(over).glance, JSON.stringify(over)).toBeFalsy()
    }
  })

  it('names the role before anything about the registry', () => {
    // Below member the server strips positions, so an empty layer is explained
    // by the account, whatever the registry would have said.
    expect(on({ reason: 'Log in.', registry: { status: 'empty' } }).key).toBe('Log in.')
    expect(on({ registry: { status: 'forbidden' } }).key).toBe(NODEPOS_GUEST_TEXT)
  })

  // The line is the role's own reason (auth.js nodePosReason), so a guest reads
  // that logging in is the step and a hunter reads that an admin verifies them
  // (#174). Since #630 there is no note under the stops to carry it: this line
  // is the one place a tap on the rail's button answers.
  it('says the reason it was handed, one per role', () => {
    const guest = 'Node positions need an account. Log in to switch the layer on.'
    const hunter = 'Node positions need a verified member account. An admin verifies you.'
    expect(on({ reason: guest }).key).toBe(guest)
    expect(on({ reason: hunter }).key).toBe(hunter)
  })

  it('marks a stale registry, on both of the states that drew from one', () => {
    // With the key gone (#631) the stale warning is the whole line here, so it
    // must read as a sentence rather than as something appended to a legend.
    expect(on({ registry: { status: 'ok', stale: true }, drawn: 2 }).key).toBe(NODEPOS_STALE_TEXT)
    expect(on({ registry: { status: 'ok', stale: true }, drawn: 0 }).key)
      .toBe(NODEPOS_NONE_IN_VIEW_TEXT + ' · ' + NODEPOS_STALE_TEXT)
    // Not on a state that drew from no registry at all.
    expect(on({ registry: { status: 'unavailable', stale: true } }).key).toBe(NODEPOS_UNAVAILABLE_TEXT)
  })

  // The separator belongs to the join, not to the text. Carrying it inside the
  // constant is what made the line start with " · " the moment the key it was
  // written to follow went away.
  it('never opens a line with a separator', () => {
    for (const over of [{ registry: { status: 'ok', stale: true }, drawn: 2 },
      { registry: { status: 'ok', stale: true }, drawn: 0 }]) {
      expect(on(over).key.startsWith(' ')).toBe(false)
      expect(on(over).key.startsWith('·')).toBe(false)
    }
    expect(NODEPOS_STALE_TEXT.startsWith(' ')).toBe(false)
  })

  it('says nothing at all while the layer is off', () => {
    expect(nodePosPresentation({ on: false, registry: { status: 'ok' }, drawn: 5 })).toEqual({ key: '' })
    expect(nodePosPresentation()).toEqual({ key: '' })
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
    // A bad_bbox, an error code it does not know: all "no registry answer",
    // none of them a claim that the registry is empty.
    expect(registryStatusFor(400, 'bad_bbox')).toBe('unavailable')
    expect(registryStatusFor(502, 'something-new')).toBe('unavailable')
  })

  // #591: a 5xx with no error code of ours is something in front of the map
  // server (a proxy timing out on the cold registry fetch), or the server
  // falling over, not the server saying the registry is out.
  it('reads a 5xx without an error code as the map server not answering', () => {
    expect(registryStatusFor(500, undefined)).toBe('server_unreachable')
    expect(registryStatusFor(502, undefined)).toBe('server_unreachable')
    expect(registryStatusFor(504, '')).toBe('server_unreachable')
    expect(registryStatusFor(503, 'registry_unavailable')).toBe('unavailable')
  })
})

describe('nextNotice — a glance shows once per outage (#591)', () => {
  it('shows a line that is no glance, and forgets any glance', () => {
    expect(nextNotice({ key: NODEPOS_EMPTY_TEXT }, NODEPOS_UNAVAILABLE_TEXT))
      .toEqual({ text: NODEPOS_EMPTY_TEXT, hideAfterMs: 0, glanced: '' })
    expect(nextNotice({ key: '' }, NODEPOS_UNAVAILABLE_TEXT)).toEqual({ text: '', hideAfterMs: 0, glanced: '' })
  })
  it('shows a glance once, for 3 s, and leaves it gone on the draws after it', () => {
    const first = nextNotice({ key: NODEPOS_UNAVAILABLE_TEXT, glance: true }, '')
    expect(first).toEqual({ text: NODEPOS_UNAVAILABLE_TEXT, hideAfterMs: NODEPOS_GLANCE_MS, glanced: NODEPOS_UNAVAILABLE_TEXT })
    expect(NODEPOS_GLANCE_MS).toBe(3000)
    expect(nextNotice({ key: NODEPOS_UNAVAILABLE_TEXT, glance: true }, first.glanced))
      .toEqual({ text: null, hideAfterMs: 0, glanced: NODEPOS_UNAVAILABLE_TEXT })
  })
  it('shows it again when the outage changes, or comes back after it ended', () => {
    expect(nextNotice({ key: NODEPOS_SERVER_UNREACHABLE_TEXT, glance: true }, NODEPOS_UNAVAILABLE_TEXT).text)
      .toBe(NODEPOS_SERVER_UNREACHABLE_TEXT)
    const ended = nextNotice({ key: '' }, NODEPOS_UNAVAILABLE_TEXT)
    expect(nextNotice({ key: NODEPOS_UNAVAILABLE_TEXT, glance: true }, ended.glanced).text).toBe(NODEPOS_UNAVAILABLE_TEXT)
  })
})

describe('nodePosKeyText — kept in step with the app copy', () => {
  it('says the registry is empty, and otherwise says nothing', () => {
    expect(nodePosKeyText({ registryEmpty: true })).toBe(NODEPOS_EMPTY_TEXT)
    expect(nodePosKeyText({ registryEmpty: false })).toBe('')
    expect(nodePosKeyText()).toBe('')
  })
})
