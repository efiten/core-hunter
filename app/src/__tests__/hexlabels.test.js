import { describe, it, expect } from 'vitest'
import { HEX_LABEL_MIN_ZOOM, HEX_LABEL_MAX, hexCellLabel, showHexLabels } from '../hexlabels.js'

const at = (s) => `2026-09-04T13:${s}:00Z`
const rec = (id, kind, rx_at) => ({ sender_id: id, sender_kind: kind, rx_at })

describe('hexCellLabel', () => {
  it('lists the 4-character prefixes of the nodes heard in the cell, newest first', () => {
    const rows = [rec('7e76aa'.padEnd(64, '0'), 'advert_pubkey', at('10')), rec('4ac3bb', 'discover_pubkey', at('20')), rec('a1b2cc', 'relay', at('15'))]
    expect(hexCellLabel(rows)).toBe('4ac3 a1b2 7e76')
  })
  it('names a node once, however many receptions and id variants it has', () => {
    const rows = [rec('7e76aa'.padEnd(64, '0'), 'advert_pubkey', at('10')), rec('7e76aabb', 'discover_pubkey', at('11')), rec('7E76AA', 'relay', at('12'))]
    expect(hexCellLabel(rows)).toBe('7e76')
  })
  // A 1-byte hash names one of 256 nodes, and a refused identity has no id at
  // all (#558): neither is something to print as who was here.
  it('never takes a prefix from a hash kind or a record without an id', () => {
    const rows = [rec('4a', 'direct_hash', at('10')), rec('64', 'path_hash', at('11')), rec(null, null, at('12')), rec('c3d4ee', 'advert_pubkey', at('13'))]
    expect(hexCellLabel(rows)).toBe('c3d4')
    expect(hexCellLabel([rec('4a', 'direct_hash', at('10'))])).toBe('')
  })
  it('stops at three, and says how many more there were', () => {
    const rows = ['aaaa11', 'bbbb22', 'cccc33', 'dddd44', 'eeee55'].map((id, i) => rec(id, 'advert_pubkey', at(String(10 + i).padStart(2, '0'))))
    expect(HEX_LABEL_MAX).toBe(3)
    expect(hexCellLabel(rows)).toBe('eeee dddd cccc +2')
  })
  it('is empty for nothing', () => {
    expect(hexCellLabel([])).toBe('')
    expect(hexCellLabel(undefined)).toBe('')
  })
})

describe('showHexLabels', () => {
  // Four characters at 10px need a cell wider than the label; at zoom 16 a
  // cell is about 110 m and the label fits with room, at 15 it does not.
  it('shows labels from zoom 16, not below', () => {
    expect(HEX_LABEL_MIN_ZOOM).toBe(16)
    expect(showHexLabels(15.9)).toBe(false)
    expect(showHexLabels(16)).toBe(true)
  })
})
