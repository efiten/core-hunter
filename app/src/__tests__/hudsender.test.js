import { describe, it, expect } from 'vitest'
import { senderReadout } from '../hudsender.js'

describe('senderReadout', () => {
  it('uses the resolved label for a direct origin', () => {
    const r = senderReadout({ sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: 'alpha', hops: 0 })
    expect(r.text).toBe('alpha')
    expect(r.viaRelay).toBe(false)
  })

  it('falls back to a shortened id prefix when there is no label', () => {
    const r = senderReadout({ sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: null, hops: 0 })
    expect(r.text).toBe('ab12cd')
    expect(r.viaRelay).toBe(false)
  })

  it('marks a relayed reception as heard via the last-hop repeater', () => {
    const r = senderReadout({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: null, hops: 2 })
    expect(r.text).toBe('via a1b2f3')
    expect(r.viaRelay).toBe(true)
  })

  it('prefers the relay label over its id when resolved', () => {
    const r = senderReadout({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: 'repeater-3', hops: 1 })
    expect(r.text).toBe('via repeater-3')
    expect(r.viaRelay).toBe(true)
  })

  it('returns a placeholder when there is no sender at all', () => {
    expect(senderReadout({ sender_id: null, sender_label: null, hops: 0 }).text).toBe('—')
    expect(senderReadout(null).text).toBe('—')
  })

  it('trims whitespace-only labels rather than showing a blank readout', () => {
    const r = senderReadout({ sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: '   ', hops: 0 })
    expect(r.text).toBe('ab12cd')
  })
})

// The three cases the first cut of this file missed, each one a class that has
// already bitten another surface.
describe('senderReadout never presents an id as an identity', () => {
  // The exact regression that hit the target chip (#297/#305): feed.js's rule
  // is that the UI never renders a full-length pubkey.
  it('shortens a 64-hex pubkey rather than printing it', () => {
    const pk = 'a1b2c3d4'.repeat(8)
    expect(pk).toHaveLength(64)
    const { text } = senderReadout({ sender_id: pk, sender_kind: 'advert_pubkey' })
    expect(text).toBe('a1b2c3')
    expect(text).not.toContain(pk)
    expect(text.length).toBeLessThan(10)
  })

  // meshpacket.js sets sender_label to the 2-hex source hash for a DIRECT
  // packet, so the label branch would print "4a" — indistinguishable from a
  // resolved short name. names.js refuses to resolve 2-hex ids and feed.js
  // keeps direct_hash out of TARGET_KINDS, both because it is a 256-way
  // collision space; the HUD must not be the one surface that disagrees.
  it('marks a 2-hex direct_hash as an id, never as a name', () => {
    const { text } = senderReadout({ sender_id: '4a', sender_label: '4a', sender_kind: 'direct_hash' })
    expect(text).toBe('#4a')
  })

  it('ignores a direct_hash label even when it looks like a real name', () => {
    const { text } = senderReadout({ sender_id: '4a', sender_label: 'Repeater-Zuid', sender_kind: 'direct_hash' })
    expect(text).toBe('#4a')
  })

  it('shows a channel name as-is — that one is a real, operator-set name', () => {
    const { text } = senderReadout({ sender_id: 'abcdef', sender_label: 'Gent', sender_kind: 'channel_name' })
    expect(text).toBe('Gent')
  })
})
