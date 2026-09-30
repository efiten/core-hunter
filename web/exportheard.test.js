import { describe, it, expect } from 'vitest'
import { heardModel, routeSegments, mappedCells, placeLabels, tint, windowText, huntersText, exportFileName, scaleBar, idLabel, fitText, FAR_KM, CELL_SIZE, CELL_RES } from './exportheard.js'
import { hexSizeForRes } from './hexgrid.js'
import { coverageStars, rayStyle, rayStrength } from './coverage.js'

// #666: the "Repeaters heard" export. The image shows the reach layer's stars
// as the map has them; these are the rules that decide what goes on it.

// A repeater's hearing, as /api/points returns it: a discover reply names the
// node by an 8-byte prefix and is two-way.
const hearing = (id, lat, lon, rssi, extra = {}) => ({ sender_id: id, sender_kind: 'discover_pubkey', sender_role: 'Repeater', lat, lon, rssi, rx_at: '2026-09-07T12:00:00Z', hunter_name: 'kas', ...extra })
const view = { west: 5.5, east: 6.2, south: 51.6, north: 52.1 }
const starsOf = (points, positions = {}) => coverageStars(points, { positionOf: (id) => positions[id] || null })

describe('heardModel (#666)', () => {
  const pts = [
    hearing('aa', 51.80, 5.80, -70), hearing('aa', 51.82, 5.84, -110),
    hearing('bb', 51.90, 5.90, -95),
  ]
  const positions = { aa: { lat: 51.81, lon: 5.82 }, bb: { lat: 51.91, lon: 5.91 } }

  it('draws every star whose origin is in view, with its hue and name', () => {
    const m = heardModel({ stars: starsOf(pts, positions), view, nameOf: (id) => id.toUpperCase() })
    expect(m.drawn.map((s) => [s.id, s.name, s.origin.kind])).toEqual([['aa', 'AA', 'advertised'], ['bb', 'BB', 'advertised']])
    expect(m.drawn.every((s) => Number.isInteger(s.slot))).toBe(true)
  })

  it('gives each ray the map\'s width and opacity, and its strength for the tint', () => {
    const m = heardModel({ stars: starsOf(pts, positions), view })
    const aa = m.drawn.find((s) => s.id === 'aa')
    expect(aa.rays.map((r) => r.rssi)).toEqual([-70, -110])
    expect(aa.rays[0]).toMatchObject({ lon: 5.80, lat: 51.80, ...rayStyle(-70), s: rayStrength(-70) })
    expect(aa.rays[1].s).toBeLessThan(aa.rays[0].s)
  })

  it('leaves out a star whose origin is outside the view', () => {
    const far = { aa: { lat: 50.5, lon: 4.0 }, bb: positions.bb }
    const m = heardModel({ stars: starsOf([hearing('aa', 50.5, 4.01, -80), pts[2]], far), view })
    expect(m.drawn.map((s) => s.id)).toEqual(['bb'])
  })

  it('names a star whose nearest hearing is farther than 30 km, and does not draw it', () => {
    // A registry position 40 km from every hearing cannot be right.
    const wrong = { aa: { lat: 51.81, lon: 5.82 }, bb: { lat: 51.55, lon: 5.9 + 0 } }
    const stars = starsOf([hearing('bb', 51.91, 5.91, -90), ...pts.slice(0, 2)], wrong)
    const bbFar = heardModel({ stars, view: { ...view, south: 51.5 }, nameOf: (id) => id })
    expect(FAR_KM).toBe(30)
    expect(bbFar.drawn.map((s) => s.id)).toEqual(['aa'])
    expect(bbFar.offMap).toEqual([{ name: 'bb', km: 40 }])
  })

  it('counts repeaters, receptions and the farthest hearing of what it draws', () => {
    const m = heardModel({ stars: starsOf(pts, positions), view })
    expect(m.numbers.repeaters).toBe(2)
    expect(m.numbers.receptions).toBe(3)
    // aa's hearings are both about 1.77 km from 51.81,5.82; bb's is 1.31.
    expect(m.numbers.farthestKm).toBeCloseTo(1.77, 1)
  })

  // AGENTS.md §5.4 item 6: a hash is an id, never a name. A relay hash star
  // has no registry name to fall back on, so it reads as the ticker reads it,
  // '#' and the id; a key without a name reads as its prefix.
  it('names a relay-hash star with a #, and a nameless key by its prefix', () => {
    const relay = (lat, lon, rssi) => hearing('db', lat, lon, rssi, { sender_kind: 'path_hash' })
    const stars = starsOf([relay(51.80, 5.80, -70), relay(51.82, 5.84, -90), relay(51.81, 5.81, -100), ...pts.slice(2)], { bb: positions.bb })
    const m = heardModel({ stars, view })
    expect(m.drawn.map((s) => s.name).sort()).toEqual(['#db', 'bb'])
    expect(idLabel('db', 'path_hash')).toBe('#db')
    expect(idLabel('e0', 'direct_hash')).toBe('#e0')
    expect(idLabel('db11db11f7808b97' + 'a'.repeat(48), 'advert_pubkey')).toBe('db11db11')
    // A picked id without a kind: a hash by its length, three bytes at most.
    expect(idLabel('db')).toBe('#db')
    expect(idLabel('ffee00')).toBe('#ffee00')
    expect(idLabel('db11db11f7808b97')).toBe('db11db11')
  })

  // AGENTS.md §7 rule 2: a relay id with no candidate in reach is not named
  // by a resolver. The cache resolves 2-byte ids for the points layer, so
  // only a key reads a cached name.
  it('never names a relay-hash star from the resolver cache', () => {
    const relay = (lat, lon, rssi) => hearing('db11', lat, lon, rssi, { sender_kind: 'path_hash' })
    const stars = starsOf([relay(51.80, 5.80, -70), relay(51.82, 5.84, -90), relay(51.81, 5.81, -100), ...pts.slice(2)], { bb: positions.bb })
    const m = heardModel({ stars, view, cachedNameOf: () => 'Resolved' })
    expect(m.drawn.map((s) => s.name).sort()).toEqual(['#db11', 'Resolved'])
  })

  it('reads a nameless node\'s key by its prefix, whatever kind its first hearing had', () => {
    const key = 'db11db11f7808b97' + 'a'.repeat(48)
    const stars = [{ id: key, origin: { lat: 51.81, lon: 5.82, kind: 'advertised' }, points: [hearing('db', 51.80, 5.80, -70, { sender_kind: 'path_hash' })] }]
    expect(heardModel({ stars, view }).drawn[0].name).toBe('db11db11')
  })

  it('says nothing is heard when no star is in view', () => {
    const m = heardModel({ stars: [], view })
    expect(m.drawn).toEqual([])
    expect(m.numbers).toEqual({ repeaters: 0, receptions: 0, farthestKm: 0 })
  })
})

describe('routeSegments (#666)', () => {
  const at = (min, lat, lon, hunter = 'kas') => ({ lat, lon, hunter_name: hunter, rx_at: new Date(Date.UTC(2026, 8, 7, 12, min)).toISOString() })
  it('joins one drive in time order, whatever order the points came in', () => {
    expect(routeSegments([at(2, 51.802, 5.8), at(0, 51.80, 5.8), at(1, 51.801, 5.8)]))
      .toEqual([[[5.8, 51.80], [5.8, 51.801], [5.8, 51.802]]])
  })
  it('breaks where more than 5 minutes pass, the route jumps more than 3 km, or the hunter changes', () => {
    const segs = routeSegments([
      at(0, 51.80, 5.8), at(1, 51.801, 5.8),
      at(7, 51.802, 5.8), at(8, 51.803, 5.8),        // 6 minutes later
      at(9, 51.85, 5.8), at(10, 51.851, 5.8),        // 5 km on
      at(11, 51.852, 5.8, 'ph'), at(12, 51.853, 5.8, 'ph'),
    ])
    expect(segs).toHaveLength(4)
  })
  it('keeps no one-point segment, which draws nothing', () => {
    expect(routeSegments([at(0, 51.8, 5.8), at(20, 51.9, 5.8)])).toEqual([])
  })
})

// The export's cell is a size, not a row of the grid's table (#734 changes
// what a resolution means): 360 Mercator units centre to corner, about 445 m
// point to point on the ground at 52°N, the cell of #720's reference.
describe('the export cell (#666)', () => {
  it('is the resolution whose size is closest to 360 Mercator units', () => {
    expect(CELL_SIZE).toBe(360)
    const off = (res) => Math.abs(hexSizeForRes(res) - CELL_SIZE)
    for (let res = 0; res <= 21; res++) expect(off(CELL_RES), `res ${res}`).toBeLessThanOrEqual(off(res))
  })
  it('stays within a factor of √2 of that size', () => {
    const ratio = hexSizeForRes(CELL_RES) / CELL_SIZE
    expect(ratio).toBeGreaterThan(Math.SQRT1_2)
    expect(ratio).toBeLessThan(Math.SQRT2)
  })
})

// The band's lines are one row each: several far stars would run the "left
// off" line past the picture's edge.
describe('fitText (#666)', () => {
  const measure = (t) => t.length * 10
  it('leaves a line that fits as it is', () => {
    expect(fitText('abc', 30, measure)).toBe('abc')
  })
  it('cuts a line that does not fit, with an ellipsis, inside the width', () => {
    const out = fitText('a'.repeat(20), 100, measure)
    expect(out).toBe('a'.repeat(9) + '…')
    expect(measure(out)).toBeLessThanOrEqual(100)
  })
})

describe('mappedCells (#666)', () => {
  it('gives one res-8 cell per place driven, as a closed [lon, lat] ring', () => {
    const cells = mappedCells([{ lat: 51.8, lon: 5.8 }, { lat: 51.80001, lon: 5.80001 }, { lat: 51.9, lon: 5.9 }])
    expect(cells).toHaveLength(2)
    const ring = cells[0]
    expect(ring).toHaveLength(7)
    expect(ring[0]).toEqual(ring[6])
    expect(ring[0][0]).toBeGreaterThan(5)   // lon first
    expect(ring[0][1]).toBeGreaterThan(51)
  })
})

describe('placeLabels (#666)', () => {
  const measure = (s) => s.length * 8
  it('keeps the most-heard name where two would print over each other', () => {
    const kept = placeLabels([
      { id: 'quiet', x: 100, y: 100, label: 'NL-QUIET', n: 2 },
      { id: 'busy', x: 104, y: 104, label: 'NL-BUSY', n: 40 },
    ], { measure, width: 1200, height: 1000 })
    expect([...kept]).toEqual(['busy'])
  })
  it('keeps both when they are clear of each other, with a margin', () => {
    const kept = placeLabels([
      { id: 'a', x: 100, y: 100, label: 'AAAA', n: 1 },
      { id: 'b', x: 100, y: 124, label: 'BBBB', n: 1 },
    ], { measure, width: 1200, height: 1000, lineHeight: 16, margin: 4 })
    expect(kept.size).toBe(2)
  })
  it('drops a name that would run off the image', () => {
    const kept = placeLabels([{ id: 'edge', x: 1180, y: 500, label: 'NL-FAR-EAST', n: 1 }], { measure, width: 1200, height: 1000 })
    expect(kept.size).toBe(0)
  })
})

describe('the small rules of the band (#666)', () => {
  it('tints a weak ray towards white and leaves a strong one its hue', () => {
    expect(tint('#2a63d6', 1)).toBe('rgb(42,99,214)')
    expect(tint('#2a63d6', 0)).toBe('rgb(159,185,237)')
  })
  it('writes the window as dates', () => {
    expect(windowText('2026-08-08T10:00:00Z', '2026-09-07T20:00:00Z')).toBe('8 Aug to 7 Sep 2026')
    expect(windowText('2025-12-28T10:00:00Z', '2026-01-03T20:00:00Z')).toBe('28 Dec 2025 to 3 Jan 2026')
  })
  it('names up to three hunters and counts more', () => {
    expect(huntersText([])).toBe('')
    expect(huntersText(['kas'])).toBe('1 hunter: kas')
    expect(huntersText(['kas', 'PH', 'Chris'])).toBe('3 hunters: kas, PH, Chris')
    expect(huntersText(['a', 'b', 'c', 'd'])).toBe('4 hunters')
  })
  it('names the file after the export and the day', () => {
    expect(exportFileName(Date.UTC(2026, 8, 27, 12))).toBe('mesh-hunter-repeaters-heard-2026-09-27.png')
  })
  it('picks the longest round scale length that fits', () => {
    expect(scaleBar(20)).toEqual({ px: 100, label: '2 km' })
    expect(scaleBar(3)).toEqual({ px: 100, label: '300 m' })
  })
})
