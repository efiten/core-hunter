import { describe, it, expect } from 'vitest'
import { HEX_LABEL_MIN_ZOOM, HEX_LABEL_MAX, hexCellLabel, showHexLabels, planHexLabels } from '../hexlabels.js'
import { hexCellAt } from '../hexgrid.js'

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

describe('planHexLabels', () => {
  // One marker per cell, kept while the cell stays in view. The map used to
  // rebuild every label marker when any one text changed, so each reception
  // at zoom 16 and up was a DOM rebuild of the whole set.
  const cell = (lat, lon, res = 12) => hexCellAt(lat, lon, res)
  const A = cell(51.84, 5.86), B = cell(51.845, 5.87), C = cell(51.85, 5.88)
  const item = (id, label) => ({ id, label, lat: 0, lon: 0 })

  it('relabels only the cell whose text changed, and leaves the others alone', () => {
    const drawn = new Map([[A, '7e76'], [B, '4ac3'], [C, 'c3d4']])
    const next = [item(A, '7e76'), item(B, '9f01 4ac3'), item(C, 'c3d4')]
    expect(planHexLabels(drawn, next)).toEqual({ add: [], relabel: [next[1]], remove: [] })
  })
  it('adds a cell that came into view and removes one that left, without touching the rest', () => {
    const drawn = new Map([[A, '7e76'], [B, '4ac3']])
    const next = [item(B, '4ac3'), item(C, 'c3d4')]
    expect(planHexLabels(drawn, next)).toEqual({ add: [next[1]], relabel: [], remove: [A] })
  })
  it('plans nothing for a tick that changes nothing', () => {
    const drawn = new Map([[A, '7e76'], [B, '4ac3']])
    expect(planHexLabels(drawn, [item(B, '4ac3'), item(A, '7e76')])).toEqual({ add: [], relabel: [], remove: [] })
  })
  // A marker's place comes from its cell. After a zoom that changes the hex
  // resolution the same point sits in another cell with another centre, so
  // the same text must not keep the old marker where the old cell was.
  it('replaces a marker when the resolution changes, even with the same text', () => {
    const coarse = cell(51.84, 5.86, 12), fine = cell(51.84, 5.86, 13)
    const next = [item(fine, '7e76')]
    expect(planHexLabels(new Map([[coarse, '7e76']]), next)).toEqual({ add: next, relabel: [], remove: [coarse] })
  })
  it('removes everything when no cell is labelled, and adds everything onto an empty map', () => {
    expect(planHexLabels(new Map([[A, '7e76'], [B, '4ac3']]), [])).toEqual({ add: [], relabel: [], remove: [A, B] })
    const next = [item(A, '7e76'), item(B, '4ac3')]
    expect(planHexLabels(new Map(), next)).toEqual({ add: next, relabel: [], remove: [] })
  })
})
