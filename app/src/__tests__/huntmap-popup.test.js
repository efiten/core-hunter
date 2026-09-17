import { describe, it, expect } from 'vitest'
import { popupHtml } from '../huntmap.js'

// The point popup names one reception the way the HUD does (hudsender.js): a
// 1-byte hash is an id, printed with its # mark, until its attribution by
// reach (#661) places it on a named node (AGENTS.md 5.4 item 6). A path hash
// is a relay hop, so it reads as a repeater like a relay id.
const sender = (r) => popupHtml({ rssi: -90, snr: 4, packet_type: 5, ...r }, new Set()).split('<br>')[2]
const HEUMEN = { pubkey: '64aa' + '0'.repeat(60), name: 'Heumensoord-RPT', lat: 51.8, lon: 5.9 }

describe('popupHtml names the sender without dressing a hash as a name', () => {
  it('prints an unplaced path hash with its # mark', () => {
    expect(sender({ sender_kind: 'path_hash', sender_id: '64', sender_label: '64' })).toBe('repeater #64')
  })
  it('prints a collided direct hash with its # mark', () => {
    expect(sender({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a', _attr: { rule: 'collision', count: 2 } })).toBe('sender #4a')
  })
  it('names a placed path hash by its node', () => {
    expect(sender({ sender_kind: 'path_hash', sender_id: '64', sender_label: '64', _attr: { rule: 'node', node: HEUMEN } })).toBe('repeater ~Heumensoord-RPT')
  })
  it('names a relay placed on one node with no resolver label', () => {
    expect(sender({ sender_kind: 'relay', sender_id: '64aa', sender_label: null, _attr: { rule: 'node', node: HEUMEN } })).toBe('repeater ~Heumensoord-RPT')
  })
  it('keeps the id of a collided relay', () => {
    expect(sender({ sender_kind: 'relay', sender_id: '4a4a', sender_label: 'repeater-3', _attr: { rule: 'collision', count: 2 } })).toBe('repeater 4a4a')
  })
})
