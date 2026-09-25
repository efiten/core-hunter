import { describe, it, expect } from 'vitest'
import { bearingDeg, relativeAngle, headingFor, arrowFor, registryMatch, arrowTarget, arrowChanged, COMPASS_STALE_MS } from '../arrow.js'
import { registryIndex } from '../attribution.js'
import { GPS_STALE_MS } from '../lifecycle.js'

const M_PER_DEG = 111320
const HOME = { lat: 51.85, lon: 5.88 }
const east = (km) => ({ lat: HOME.lat, lon: HOME.lon + (km * 1000) / (M_PER_DEG * Math.cos((HOME.lat * Math.PI) / 180)) })
const north = (km) => ({ lat: HOME.lat + (km * 1000) / M_PER_DEG, lon: HOME.lon })

describe('bearingDeg', () => {
  it('measures the initial bearing clockwise from true north', () => {
    expect(bearingDeg(HOME, north(1))).toBeCloseTo(0, 1)
    expect(bearingDeg(HOME, east(1))).toBeCloseTo(90, 1)
    expect(bearingDeg(north(1), HOME)).toBeCloseTo(180, 1)
    expect(bearingDeg(east(1), HOME)).toBeCloseTo(270, 1)
  })
})

describe('relativeAngle', () => {
  it('turns the bearing into a turn from the heading, the shortest way', () => {
    expect(relativeAngle(10, 350)).toBeCloseTo(20)
    expect(relativeAngle(350, 10)).toBeCloseTo(-20)
    expect(relativeAngle(90, 90)).toBeCloseTo(0)
    expect(relativeAngle(180, 0)).toBeCloseTo(180)
  })
})

describe('headingFor', () => {
  const now = 100000
  it('takes the GPS course while the source is the course', () => {
    expect(headingFor({ source: 'course', course: 90, compass: { deg: 10, at: now }, now })).toBe(90)
    expect(headingFor({ source: 'course', course: null, compass: { deg: 10, at: now }, now })).toBe(null)
  })
  it('takes a fresh compass reading while the source is the device', () => {
    expect(headingFor({ source: 'device', course: 90, compass: { deg: 45, at: now - 500 }, now })).toBe(45)
    expect(headingFor({ source: 'device', course: 90, compass: { deg: 45, at: now - COMPASS_STALE_MS - 1 }, now })).toBe(null)
    expect(headingFor({ source: 'device', course: 90, compass: null, now })).toBe(null)
  })
  it('has no heading without a source', () => {
    expect(headingFor({ source: null, course: 90, compass: { deg: 45, at: now }, now })).toBe(null)
  })
})

describe('arrowFor', () => {
  const now = 200000
  const target = { ...east(1), kind: 'advertised' }
  const ok = { target, fix: HOME, lastFixAt: now - 1000, heading: 90, now }
  it('points at the target relative to where you are heading', () => {
    expect(arrowFor(ok).angle).toBeCloseTo(0, 0)
    expect(arrowFor(ok).kind).toBe('advertised')
    expect(arrowFor({ ...ok, heading: 0 }).angle).toBeCloseTo(90, 0)
    expect(arrowFor({ ...ok, heading: 180 }).angle).toBeCloseTo(-90, 0)
    expect(arrowFor({ ...ok, target: { ...east(1), kind: 'estimate' } }).kind).toBe('estimate')
  })
  it('draws nothing without a target, a valid fix, a recent fix or a heading', () => {
    expect(arrowFor({ ...ok, target: null })).toBe(null)
    expect(arrowFor({ ...ok, fix: null })).toBe(null)
    expect(arrowFor({ ...ok, fix: { lat: NaN, lon: 5 } })).toBe(null)
    expect(arrowFor({ ...ok, lastFixAt: now - GPS_STALE_MS - 1 })).toBe(null)
    expect(arrowFor({ ...ok, lastFixAt: null })).toBe(null)
    expect(arrowFor({ ...ok, heading: null })).toBe(null)
  })
})

const NODE_A = { pubkey: 'a1b2c3' + '0'.repeat(58), name: 'Heumensoord-RPT', ...east(3) }
const NODE_B = { pubkey: 'a1b2ff' + '0'.repeat(58), name: 'Zuid', ...north(4) }
const index = registryIndex([NODE_A, NODE_B])

describe('registryMatch', () => {
  it('finds an advert by its whole key and a discover or reply id by a unique prefix', () => {
    expect(registryMatch({ sender_kind: 'advert_pubkey', sender_id: NODE_A.pubkey }, index)).toBe(NODE_A)
    expect(registryMatch({ sender_kind: 'discover_pubkey', sender_id: 'a1b2c300' }, index)).toBe(NODE_A)
    expect(registryMatch({ sender_kind: 'trace_reply', sender_id: 'a1b2ff' }, index)).toBe(NODE_B)
    expect(registryMatch({ sender_kind: 'telemetry_reply', sender_id: NODE_B.pubkey.toUpperCase() }, index)).toBe(NODE_B)
    expect(registryMatch({ sender_kind: 'anon_reply', sender_id: NODE_B.pubkey }, index)).toBe(NODE_B)
  })
  it('names no node for a prefix two nodes share, a short id, or another kind', () => {
    expect(registryMatch({ sender_kind: 'discover_pubkey', sender_id: 'a1b2' }, index)).toBe(null)
    expect(registryMatch({ sender_kind: 'discover_pubkey', sender_id: 'a1' }, index)).toBe(null)
    expect(registryMatch({ sender_kind: 'relay', sender_id: 'a1b2c3' }, index)).toBe(null)
    expect(registryMatch({ sender_kind: 'advert_pubkey', sender_id: NODE_A.pubkey }, null)).toBe(null)
  })
})

describe('arrowTarget', () => {
  // A ring of receptions around a spot 2 km east, so the estimate lands there.
  const ring = (id, kind, attr, n = 6) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI
    const c = east(2)
    return { sender_id: id, sender_kind: kind, _attr: attr, rssi: -90, lat: c.lat + (500 * Math.sin(a)) / M_PER_DEG, lon: c.lon + (500 * Math.cos(a)) / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)) }
  })

  it('points a reception placed on a node at that node\'s advertised position', () => {
    const rec = { sender_kind: 'path_hash', sender_id: 'a1', _attr: { rule: 'node', node: NODE_A } }
    expect(arrowTarget(rec, { index, rows: [] })).toEqual({ lat: NODE_A.lat, lon: NODE_A.lon, kind: 'advertised' })
  })

  // Collided receptions share no star (starKey null), so they must not pool
  // into an estimate of their own either.
  it('draws nothing on a collision, however many collided receptions there are', () => {
    const collision = { rule: 'collision', count: 2 }
    const rows = [...ring('a1', 'path_hash', collision), ...ring('a1', 'path_hash', { rule: 'estimate', prefixKnown: false })]
    expect(arrowTarget({ sender_kind: 'path_hash', sender_id: 'a1', _attr: collision }, { index, rows })).toBe(null)
  })

  it('uses the registry position of an advert, discover or reply id when it has one', () => {
    const rows = ring(NODE_A.pubkey, 'advert_pubkey', null)
    expect(arrowTarget({ sender_kind: 'advert_pubkey', sender_id: NODE_A.pubkey }, { index, rows }).kind).toBe('advertised')
    expect(arrowTarget({ sender_kind: 'trace_reply', sender_id: 'a1b2ff' }, { index, rows: [] }).kind).toBe('advertised')
  })

  it('falls back to the estimate over the same sender\'s receptions, and needs three', () => {
    const attr = { rule: 'estimate', prefixKnown: false }
    const rows = ring('c0de', 'relay', attr)
    const t = arrowTarget({ sender_kind: 'relay', sender_id: 'c0de', _attr: attr }, { index, rows })
    expect(t.kind).toBe('estimate')
    expect(t.lat).toBeCloseTo(east(2).lat, 3)
    expect(t.lon).toBeCloseTo(east(2).lon, 3)
    expect(arrowTarget({ sender_kind: 'relay', sender_id: 'c0de', _attr: attr }, { index, rows: rows.slice(0, 2) })).toBe(null)
  })

  // Rule 2 counts only rule-2 receptions (#661): the same raw id placed on a
  // node elsewhere is that node's, and a collided one is nobody's.
  it('leaves receptions of the same raw id placed on a node or collided out of the estimate', () => {
    const attr = { rule: 'estimate', prefixKnown: false }
    const own = ring('a1', 'path_hash', attr, 2)
    const placed = ring('a1', 'path_hash', { rule: 'node', node: NODE_A }, 4)
    const collided = ring('a1', 'path_hash', { rule: 'collision', count: 2 }, 4)
    expect(arrowTarget({ sender_kind: 'path_hash', sender_id: 'a1', _attr: attr }, { index, rows: [...own, ...placed, ...collided] })).toBe(null)
  })

  it('has nothing to point at without a sender, or for a channel name', () => {
    expect(arrowTarget(null, { index, rows: [] })).toBe(null)
    expect(arrowTarget({ packet_type: 'Trace', rssi: -80 }, { index, rows: [] })).toBe(null)
    const rows = ring('alice', 'channel_name', null)
    expect(arrowTarget({ sender_kind: 'channel_name', sender_id: 'alice' }, { index, rows })).toBe(null)
  })
})

describe('arrowChanged', () => {
  const dir = (angle, kind = 'advertised') => ({ angle, kind })
  it('redraws when the arrow appears, goes, changes kind or turns far enough', () => {
    expect(arrowChanged(null, dir(10), 5)).toBe(true)
    expect(arrowChanged(dir(10), null, 5)).toBe(true)
    expect(arrowChanged(null, null, 5)).toBe(false)
    expect(arrowChanged(dir(10), dir(10, 'estimate'), 5)).toBe(true)
    expect(arrowChanged(dir(0), dir(5), 5)).toBe(true)
    expect(arrowChanged(dir(0), dir(4), 5)).toBe(false)
  })
  it('measures the turn the short way round', () => {
    expect(arrowChanged(dir(178), dir(-178), 5)).toBe(false)
    expect(arrowChanged(dir(178), dir(-176), 5)).toBe(true)
  })
})
