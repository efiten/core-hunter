import { describe, it, expect, vi } from 'vitest'
import { rowsBounds, createRowAttributor, RETRY_MS } from './rowattribution.js'

const NODE = { pubkey: 'a1b2' + '0'.repeat(60), name: 'Mast Noord', lat: 51.0, lon: 4.0 }
const ROW = { sender_kind: 'relay', sender_id: 'a1b2', sender_label: 'repeater-3', lat: 51.01, lon: 4.01, rssi: -90 }
const ok = (nodes) => ({ status: 'ok', nodes, truncated: false })

describe('rowsBounds', () => {
  it('is the box around the rows that have a position', () => {
    expect(rowsBounds([{ lat: 51, lon: 4 }, { lat: 52, lon: 3 }, { lat: null, lon: null }]))
      .toEqual({ south: 51, west: 3, north: 52, east: 4 })
  })
  it('is null without a positioned row', () => {
    expect(rowsBounds([])).toBe(null)
    expect(rowsBounds([{ lat: null, lon: 4 }])).toBe(null)
  })
})

describe('createRowAttributor (#663)', () => {
  it('places a relay id on the one registry node in reach', async () => {
    const a = createRowAttributor({ fetchRegistry: async () => ok([NODE]), allowed: () => true })
    const rows = [{ ...ROW }]
    await a.attribute(rows)
    expect(rows[0]._attr).toEqual({ rule: 'node', node: NODE })
  })
  it('asks for the box around the rows, not around the view', async () => {
    const fetchRegistry = vi.fn(async () => ok([]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true })
    await a.attribute([{ ...ROW }, { ...ROW, lat: 52.5, lon: 5.5 }])
    expect(fetchRegistry).toHaveBeenCalledWith({ south: 51.01, west: 4.01, north: 52.5, east: 5.5 })
  })
  it('asks nothing for a guest, and leaves the resolver name its guess mark', async () => {
    const fetchRegistry = vi.fn(async () => ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => false })
    const rows = [{ ...ROW }]
    await a.attribute(rows)
    expect(fetchRegistry).not.toHaveBeenCalled()
    expect(rows[0]._attr).toEqual({ rule: 'estimate', prefixKnown: false })
  })
  it('asks nothing when no row carries an id the rule covers', async () => {
    const fetchRegistry = vi.fn(async () => ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true })
    const rows = [{ sender_kind: 'advert_pubkey', sender_id: 'ab'.repeat(32), lat: 51, lon: 4, rssi: -90 }]
    await a.attribute(rows)
    expect(fetchRegistry).not.toHaveBeenCalled()
    expect(rows[0]._attr).toBe(null)
  })
  it('reuses a slice that still covers the rows, until it is a minute old', async () => {
    let now = 1000
    const fetchRegistry = vi.fn(async () => ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true, now: () => now })
    await a.attribute([{ ...ROW }, { ...ROW, lat: 51.2, lon: 4.2 }])
    await a.attribute([{ ...ROW, lat: 51.1, lon: 4.1 }])
    expect(fetchRegistry).toHaveBeenCalledTimes(1)
    await a.attribute([{ ...ROW, lat: 53, lon: 4.1 }])   // outside the slice
    expect(fetchRegistry).toHaveBeenCalledTimes(2)
    now += 61000
    await a.attribute([{ ...ROW, lat: 53, lon: 4.1 }])   // covered, but stale
    expect(fetchRegistry).toHaveBeenCalledTimes(3)
  })
  it('treats a refused, failed or truncated registry as no registry', async () => {
    for (const answer of [{ status: 'forbidden', nodes: [] }, { status: 'server_unreachable', nodes: [] }, { status: 'ok', nodes: [NODE], truncated: true }]) {
      const a = createRowAttributor({ fetchRegistry: async () => answer, allowed: () => true })
      const rows = [{ ...ROW }]
      await a.attribute(rows)
      expect(rows[0]._attr, JSON.stringify(answer)).toEqual({ rule: 'estimate', prefixKnown: false })
    }
  })
  // A registry that fails is asked again, but not on every 5 s poll of an
  // outage: after a failure the rows read without it for RETRY_MS.
  it('asks again after a failed answer, once RETRY_MS has passed', async () => {
    let now = 1000
    const fetchRegistry = vi.fn().mockResolvedValueOnce({ status: 'server_unreachable', nodes: [] }).mockResolvedValue(ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true, now: () => now })
    await a.attribute([{ ...ROW }])
    now += 5000
    await a.attribute([{ ...ROW }])
    expect(fetchRegistry).toHaveBeenCalledTimes(1)
    now += RETRY_MS
    const rows = [{ ...ROW }]
    await a.attribute(rows)
    expect(fetchRegistry).toHaveBeenCalledTimes(2)
    expect(rows[0]._attr.rule).toBe('node')
  })
  // The ticker's "all" stand attributes the filtered page and then the all
  // page on every poll. Where neither box covers the other, a slice of the
  // last box only would be fetched twice a poll, for ever.
  it('keeps what it fetched for two alternating boxes, so it asks once more and then not again', async () => {
    const fetchRegistry = vi.fn(async () => ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true, now: () => 1000 })
    const here = [{ ...ROW }], there = [{ ...ROW, lat: 52.5, lon: 5.5 }]
    for (let poll = 0; poll < 4; poll++) { await a.attribute(here.map((r) => ({ ...r }))); await a.attribute(there.map((r) => ({ ...r }))) }
    expect(fetchRegistry).toHaveBeenCalledTimes(2)
    // The second ask is the box around both.
    expect(fetchRegistry.mock.calls[1][0]).toEqual({ south: 51.01, west: 4.01, north: 52.5, east: 5.5 })
  })
  it('forgets its slice on reset, which is what a change of role calls', async () => {
    const fetchRegistry = vi.fn(async () => ok([NODE]))
    const a = createRowAttributor({ fetchRegistry, allowed: () => true })
    await a.attribute([{ ...ROW }])
    a.reset()
    await a.attribute([{ ...ROW }])
    expect(fetchRegistry).toHaveBeenCalledTimes(2)
  })
})
