import { describe, it, expect } from 'vitest'
import { reachModel, idwRssi, lineOfSight, sampleSteps, pickReachStar, REACH_EDGE_KM, IDW_NEAREST, REPEATER_MAST_M } from './exportreach.js'
import { coverageStars, RAY_ALT_M } from './coverage.js'
import { hexCellAt, hexBoundary, hexSizeForRes } from './hexgrid.js'
import { kmBetween, CELL_RES } from './exportheard.js'

// #720: "Reach of one repeater". One star, drawn on the export's cell (CELL_RES): where it
// was heard, where the hunters drove without hearing it, and what the
// repeater reaches in between. That last part is thought from the repeater
// (Kasper, 27 September): along unbroken lines to where it was heard, in the
// wedges between neighbouring lines, and only where it sees over the ground.

const hearing = (lat, lon, rssi, min = 0) => ({ sender_id: 'db11db11f7808b97', sender_kind: 'discover_pubkey', sender_role: 'Repeater',
  lat, lon, rssi, hunter_name: 'kas', rx_at: `2026-09-07T12:${String(min).padStart(2, '0')}:00Z` })
// A reception of another repeater: the hunters drove through its cell.
const drove = (lat, lon) => ({ sender_id: 'ffee0011aabbccdd', sender_kind: 'discover_pubkey', sender_role: 'Repeater', lat, lon, rssi: -90, hunter_name: 'kas', rx_at: '2026-09-07T12:00:00Z' })
const node = { lat: 51.84, lon: 5.86 }
const flat = () => 10

// A ring of hearings around the node, about 2 km across.
const ring = [
  hearing(51.849, 5.86, -70), hearing(51.84, 5.875, -95), hearing(51.831, 5.86, -105),
  hearing(51.84, 5.845, -112), hearing(51.846, 5.869, -85), hearing(51.834, 5.851, -100),
]
// Three hearings in one cell 1 km east of the node: a single line.
const east = [1, 2, 3].map((min) => hearing(51.84, 5.875, -94 - min, min))
// Two lines, 2.4 km north and 2.2 km north-east, whose ends are 1.6 km apart.
const wedge = [hearing(51.862, 5.86, -80), hearing(51.855, 5.88, -85), hearing(51.862, 5.86, -81)]

const starOf = (pts) => coverageStars(pts, { positionOf: () => node })[0]
// The place `km` from `o` at `deg` degrees from east, counter-clockwise.
const toward = (o, km, deg) => ({
  lat: o.lat + (km * Math.sin((deg * Math.PI) / 180)) / 110.574,
  lon: o.lon + (km * Math.cos((deg * Math.PI) / 180)) / (111.32 * Math.cos((o.lat * Math.PI) / 180)),
})
const ids = (cells) => cells.map((c) => c.id)
// The cells a straight segment passes through, in order, sampled every
// 80 m like the model's own lines.
const cellsAlong = (from, to, res = CELL_RES) => {
  const steps = Math.max(1, Math.ceil(kmBetween(from, to) / sampleSteps(res).walkKm))
  const out = []
  for (let i = 0; i <= steps; i++) {
    const id = hexCellAt(from.lat + ((to.lat - from.lat) * i) / steps, from.lon + ((to.lon - from.lon) * i) / steps, res)
    if (out[out.length - 1] !== id) out.push(id)
  }
  return out
}
const centreOf = (id) => {
  const r = hexBoundary(id).slice(0, 6)
  return { lat: r.reduce((s, q) => s + q[0], 0) / 6, lon: r.reduce((s, q) => s + q[1], 0) / 6 }
}
// A lattice one resolution finer than the export's cell (LATTICE) around a repeater at the centre of cell (0, 0): lines
// east, (k, 0), north-east, (0, k), and south-east, (k, -k), run through
// the centres of their cells, about 140 m apart at 52°N.
const LATTICE = CELL_RES + 1
const [, q0, r0] = hexCellAt(51.842, 5.86, LATTICE).split(':').map(Number)
const cell = (i, j) => `${LATTICE}:${q0 + i}:${r0 + j}`
const at = (i, j) => centreOf(cell(i, j))
const latticeModel = (pts, dark = []) => {
  const star = coverageStars(pts, { positionOf: () => at(0, 0) })[0]
  return reachModel({ star, mapped: [...pts, ...dark], elevationAt: flat, res: LATTICE }).filled
}

// The filled cells that lie on no line from the repeater: the wedges.
const offTheLines = (m) => {
  const on = new Set(m.rays.flatMap((r) => cellsAlong(r.from, r)))
  return m.filled.filter((c) => !on.has(c.id))
}

describe('reachModel: what was measured (#720)', () => {
  it('gives each heard cell the tier of its strongest hearing', () => {
    const pts = [hearing(51.849, 5.86, -70), hearing(51.8491, 5.8601, -100), ...ring.slice(1)]
    const m = reachModel({ star: starOf(pts), mapped: pts })
    expect(m.heard.find((c) => c.id === hexCellAt(51.849, 5.86, CELL_RES))).toMatchObject({ rssi: -70, tier: 'hot' })
  })

  it('draws one ray per heard cell, from the origin to its strongest hearing', () => {
    const pts = [hearing(51.849, 5.86, -100), hearing(51.8491, 5.8601, -70), ...ring.slice(1)]
    const m = reachModel({ star: starOf(pts), mapped: pts })
    expect(m.rays).toHaveLength(m.heard.length)
    const toCell = m.rays.find((r) => hexCellAt(r.lat, r.lon, CELL_RES) === hexCellAt(51.849, 5.86, CELL_RES))
    expect(toCell).toMatchObject({ lat: 51.8491, lon: 5.8601, tier: 'hot' })
  })

  it('marks a cell the hunters drove through without hearing it as mapped, not heard', () => {
    const m = reachModel({ star: starOf(ring), mapped: [...ring, drove(51.95, 5.95)] })
    expect(ids(m.silent)).toEqual([hexCellAt(51.95, 5.95, CELL_RES)])
  })

  it('counts what the map counts for the star', () => {
    const star = starOf(ring)
    const m = reachModel({ star, mapped: ring })
    expect(m.numbers.receptions).toBe(star.points.length)
    expect(m.numbers.strongest).toBe(-70)
    // The farthest hearings from 51.84,5.86: 1.0 km north and south, 1.03 km east and west.
    expect(m.numbers.farthestKm).toBeCloseTo(1.03, 1)
  })

  // A relay-hash star has no registry name: it reads as the ticker reads it,
  // '#' and the id (AGENTS.md §5.4 item 6), in the title and the file name.
  it('names a relay-hash star with a #', () => {
    const relay = ring.map((h) => ({ ...h, sender_id: 'db', sender_kind: 'path_hash' }))
    const star = coverageStars(relay, { positionOf: () => null })[0]
    expect(reachModel({ star, mapped: relay }).name).toBe('#db')
  })
  // AGENTS.md §7 rule 2: the resolver names 2-byte ids for the points layer,
  // but a relay id with no candidate in reach is not named by it.
  it('does not name a 2-byte relay-hash star from the resolver cache, and does name a key', () => {
    const relay = ring.map((h) => ({ ...h, sender_id: 'db11', sender_kind: 'path_hash' }))
    const star = coverageStars(relay, { positionOf: () => null })[0]
    expect(reachModel({ star, mapped: relay, cachedNameOf: () => 'Resolved' }).name).toBe('#db11')
    expect(reachModel({ star: starOf(ring), mapped: ring, cachedNameOf: () => 'Resolved' }).name).toBe('Resolved')
  })

  it('keeps the advertised position and the estimate apart, and hangs the rays from the advertised one', () => {
    const m = reachModel({ star: starOf(ring), mapped: ring })
    expect(m.advertised).toEqual({ lat: node.lat, lon: node.lon })
    expect(m.estimate).not.toBeNull()
    expect(m.rays.every((r) => r.from.lat === node.lat && r.from.lon === node.lon)).toBe(true)
  })

  it('hangs the rays from the estimate when there is no advertised position', () => {
    const star = coverageStars(ring, { positionOf: () => null })[0]
    const m = reachModel({ star, mapped: ring })
    expect(m.advertised).toBeNull()
    expect(m.rays[0].from).toEqual({ lat: star.origin.lat, lon: star.origin.lon })
  })
})

describe('reachModel: what is filled in, thought from the repeater (#720)', () => {
  it('fills the cells on the line from the repeater to where it was heard', () => {
    const m = reachModel({ star: starOf(east), mapped: east, elevationAt: flat })
    const line = cellsAlong(node, { lat: 51.84, lon: 5.875 })
    const heard = new Set(ids(m.heard))
    expect(line.length).toBeGreaterThan(2)
    expect(ids(m.filled).sort()).toEqual(line.filter((c) => !heard.has(c)).sort())
  })

  it('does not fill across a cell driven through without hearing it', () => {
    const between = cellsAlong(node, { lat: 51.84, lon: 5.875 }).at(-2)
    const c = centreOf(between)
    const m = reachModel({ star: starOf(east), mapped: [...east, drove(c.lat, c.lon)], elevationAt: flat })
    expect(ids(m.silent)).toEqual([between])
    expect(m.filled).toEqual([])
  })

  it('fills a line again past a stretch where it was not heard (Kasper: heard at 1 2 3, not at 4 5, heard at 6 7 8)', () => {
    // A row of cells straight east of the repeater, through their centres.
    const start = centreOf(hexCellAt(51.842, 5.86, CELL_RES))
    const row = cellsAlong(start, { lat: start.lat, lon: start.lon + 0.07 }).map(centreOf)
    const pts = [2, 4, 9, 11].map((k) => hearing(row[k].lat, row[k].lon, -100, k))
    const star = coverageStars(pts, { positionOf: () => start })[0]
    const m = reachModel({ star, mapped: [...pts, drove(row[6].lat, row[6].lon), drove(row[7].lat, row[7].lon)], elevationAt: flat })
    const cell = (k) => hexCellAt(row[k].lat, row[k].lon, CELL_RES)
    // Heard at 2, 4, 9 and 11, not at 6 and 7: 0 to 4 and 9 to 11 are
    // reached; 5 and 8 lie between a shadow and a hearing, and stay open.
    expect(ids(m.filled).sort()).toEqual([0, 1, 3, 10].map(cell).sort())
  })

  it('fills between two lines past where neither was heard, and not in the shadow', () => {
    // Lines east and north-east, each heard at 1, 2 and at 7 to 10 cells
    // out, and not at 4 and 5. Their ends, 1.9 km out, are 1.9 km apart.
    const heardAt = [1, 2, 7, 8, 9, 10], shadow = [4, 5]
    const pts = heardAt.flatMap((k) => [at(k, 0), at(0, k)]).map((p, n) => hearing(p.lat, p.lon, -100, n))
    const dark = shadow.flatMap((k) => [at(k, 0), at(0, k)]).map((p) => drove(p.lat, p.lon))
    const filled = new Set(ids(latticeModel(pts, dark)))
    // 8 and 9 cells out, between the lines: reached on both.
    expect([cell(4, 4), cell(4, 5), cell(5, 4), cell(3, 5)].every((c) => filled.has(c))).toBe(true)
    // 4 to 6 cells out, between the lines: the shadow, and the gap after it.
    expect([cell(2, 2), cell(2, 3), cell(3, 2), cell(3, 3)].some((c) => filled.has(c))).toBe(false)
    // On the lines themselves: reached up to 2 and from 7, open at 3 and 6.
    expect([cell(0, 0), cell(3, 0), cell(0, 3), cell(6, 0), cell(0, 6)].map((c) => filled.has(c))).toEqual([true, false, false, false, false])
  })

  it('takes a line to a cell on a longer line as part of that line', () => {
    // A short line to 2 cells east, a little north of the long east line
    // but in a cell it passes: the area runs between the long line and the
    // north-east one, not between the short one and the north-east one.
    const short = { lat: at(2, 0).lat + 0.0003, lon: at(2, 0).lon }
    const pts = [at(10, 0), at(0, 10), short].map((p, n) => hearing(p.lat, p.lon, -100, n))
    expect(hexCellAt(short.lat, short.lon, LATTICE)).toBe(cell(2, 0))
    expect(ids(latticeModel(pts))).toContain(cell(4, 4))
  })

  it('leaves the cell past the end of a line open, beside a longer one', () => {
    // Lines south-east (8 cells) and east (3): the wedge between them is
    // filled; the next cell east, past the east line's end, is not.
    const pts = [at(8, -8), at(3, 0)].map((p, n) => hearing(p.lat, p.lon, -100, n))
    const filled = ids(latticeModel(pts))
    expect(filled).toContain(cell(3, -1))
    expect(filled).not.toContain(cell(4, 0))
  })

  it('fills the wedge between two neighbouring lines whose ends are close', () => {
    const m = reachModel({ star: starOf(wedge), mapped: wedge, elevationAt: flat })
    expect(m.heard).toHaveLength(2)
    expect(offTheLines(m).length).toBeGreaterThan(0)
  })

  it('leaves the gap between two lines whose ends are more than 2 km apart', () => {
    // 3.3 km north and 3.1 km east: the ends are 4.5 km apart.
    const apart = [hearing(51.87, 5.86, -80), hearing(51.84, 5.905, -85), hearing(51.8702, 5.8602, -81)]
    const m = reachModel({ star: starOf(apart), mapped: apart, elevationAt: flat })
    expect(REACH_EDGE_KM).toBe(2)
    expect(m.filled.length).toBeGreaterThan(0)
    expect(offTheLines(m)).toEqual([])
  })

  it('does not fill a wedge that a cell driven through without hearing it lies in', () => {
    // A cell in the middle of the wedge, on neither line.
    const inWedge = hexCellAt(51.85395, 5.8646, CELL_RES)
    const c = centreOf(inWedge)
    const m = reachModel({ star: starOf(wedge), mapped: [...wedge, drove(c.lat, c.lon)], elevationAt: flat })
    expect(ids(m.silent)).toEqual([inWedge])
    expect(m.filled.length).toBeGreaterThan(0)
    expect(offTheLines(m)).toEqual([])
  })

  it('fills between neighbouring lines only, never the long way round', () => {
    // Lines east (1.5 km), at 30° (0.5 km) and at 60° (1.5 km), from the
    // centre of a cell so the east line keeps to one row. The outer two ends
    // are 1.5 km apart, but the short line lies between them: the cell past
    // its end is in no wedge.
    const start = centreOf(hexCellAt(51.842, 5.86, CELL_RES))
    const fan = [toward(start, 1.5, 0), toward(start, 0.5, 30), toward(start, 1.5, 60)].map((p, n) => hearing(p.lat, p.lon, -90, n))
    const star = coverageStars(fan, { positionOf: () => start })[0]
    const m = reachModel({ star, mapped: fan, elevationAt: flat })
    const past = toward(start, 0.97, 30)
    expect(m.heard).toHaveLength(3)
    expect(ids(m.filled)).not.toContain(hexCellAt(past.lat, past.lon, CELL_RES))
  })

  it('leaves a cell behind a ridge unfilled, and still draws the hearing', () => {
    const ridge = (lat, lon) => (lon > 5.862 && lon < 5.866 ? 80 : 10)
    const open = reachModel({ star: starOf(east), mapped: east, elevationAt: flat })
    const hilly = reachModel({ star: starOf(east), mapped: east, elevationAt: ridge })
    expect(hilly.filled.length).toBeLessThan(open.filled.length)
    expect(hilly.heard).toEqual(open.heard)
  })

  it('never fills a cell the hunters drove through without hearing it', () => {
    // The repeater's own cell, which no line passes through between its ends.
    const own = hexCellAt(node.lat, node.lon, CELL_RES)
    const m = reachModel({ star: starOf(east), mapped: [...east, drove(node.lat, node.lon)], elevationAt: flat })
    expect(ids(m.silent)).toEqual([own])
    expect(m.filled.length).toBeGreaterThan(0)
    expect(ids(m.filled)).not.toContain(own)
  })

  it('fills along the lines alone when the ground cannot be read', () => {
    const ridge = (lat, lon) => (lon > 5.862 && lon < 5.866 ? 80 : 10)
    const blind = reachModel({ star: starOf(east), mapped: east, elevationAt: null })
    const open = reachModel({ star: starOf(east), mapped: east, elevationAt: flat })
    expect(blind.filled.length).toBeGreaterThan(0)
    expect(ids(blind.filled)).toEqual(ids(open.filled))
    expect(reachModel({ star: starOf(east), mapped: east, elevationAt: ridge }).filled.length).toBeLessThan(blind.filled.length)
  })

  it('colours a filled cell from the hearings nearest to it', () => {
    const m = reachModel({ star: starOf(east), mapped: east, elevationAt: flat })
    expect(m.filled.every((c) => c.rssi <= -95 && c.rssi >= -97 && c.tier)).toBe(true)
  })
})

describe('lineOfSight (#720)', () => {
  const R = { lat: 51.84, lon: 5.86 }
  const far = { lat: 51.84, lon: 5.86 + 0.08 }   // about 5.5 km east
  // Ground that was not read (null, off the tiles) decides nothing: the line
  // is open there, as it is without any terrain at all.
  it('treats ground it cannot read as open, not as sea level', () => {
    expect(lineOfSight(R, far, () => null)).toBe(true)
    // The repeater's own ground unknown, 500 m everywhere else: read as sea
    // level it would sit 470 m under the ground it looks over.
    expect(lineOfSight(R, far, (lat, lon) => (lon < 5.87 ? null : 500))).toBe(true)
    expect(lineOfSight(R, far, (lat, lon) => (lon < 5.87 ? 10 : 500))).toBe(false)
  })
  it('sees over flat ground', () => {
    expect(lineOfSight(R, far, flat)).toBe(true)
  })
  it('does not see past a ridge higher than the line', () => {
    const ridge = (lat, lon) => (Math.abs(lon - 5.90) < 0.003 ? 60 : 10)   // 60 m high, halfway
    expect(lineOfSight(R, far, ridge)).toBe(false)
  })
  it('sees over a ridge the mast clears', () => {
    const low = (lat, lon) => (Math.abs(lon - 5.90) < 0.003 ? 20 : 10)
    expect(lineOfSight(R, far, low)).toBe(true)
    expect(REPEATER_MAST_M).toBe(RAY_ALT_M)
  })
  it('counts the earth bulging up between the two ends', () => {
    // 20 km over flat ground. Two antennas at the ground are hidden from
    // each other by the curve alone; a 30 m mast and a 1.5 m antenna see
    // each other up to 27.6 km apart.
    const a = { lat: 51.84, lon: 5.86 }, b = { lat: 51.84, lon: 5.86 + 0.29 }
    expect(lineOfSight(a, b, () => 0, { fromM: 0, toM: 0 })).toBe(false)
    expect(lineOfSight(a, b, () => 0)).toBe(true)
  })
})

describe('idwRssi (#720)', () => {
  it('uses the 6 nearest hearings only', () => {
    expect(IDW_NEAREST).toBe(6)
    const at = { lat: 51.84, lon: 5.86 }
    const six = Array.from({ length: 6 }, (_, i) => ({ lat: 51.84 + 0.001 * (i + 1), lon: 5.86, rssi: -80 }))
    const far = { lat: 52.5, lon: 6.5, rssi: -130 }
    expect(idwRssi(at, [...six, far])).toBeCloseTo(-80, 5)
  })
  it('leans towards the nearer hearing', () => {
    const at = { lat: 51.84, lon: 5.86 }
    const v = idwRssi(at, [{ lat: 51.841, lon: 5.86, rssi: -80 }, { lat: 51.85, lon: 5.86, rssi: -110 }])
    expect(v).toBeGreaterThan(-90)
  })
})

// The walk along a line and the sampler over an area step finer than a cell,
// so no cell is stepped over; the steps follow the cell's size, so they stay
// right when the export's cell changes.
describe('sampleSteps (#720)', () => {
  const lat = 52
  const innerKm = (res) => (hexSizeForRes(res) * Math.cos((lat * Math.PI) / 180) * Math.sqrt(3) / 2) / 1000
  it('steps inside a cell\'s inner radius at 52°N, at every resolution the grid has', () => {
    for (const res of [6, 8, 10, 12]) {
      const st = sampleSteps(res)
      expect(st.walkKm, `res ${res}`).toBeLessThan(innerKm(res))
      expect(st.latDeg * 110.574, `res ${res}`).toBeLessThan(innerKm(res))
      expect(st.lonDeg * 111.32 * Math.cos((lat * Math.PI) / 180), `res ${res}`).toBeLessThan(innerKm(res))
    }
  })
  it('scales with the cell', () => {
    const r = hexSizeForRes(7) / hexSizeForRes(8)
    expect(sampleSteps(7).walkKm / sampleSteps(8).walkKm).toBeCloseTo(r, 6)
  })
})

// Which star "Reach of one repeater" draws. A merged target row is one
// repeater under several ids, a prefix and the keys it starts; its hearings
// can form two stars (a key the registry does not place, say). That is one
// pick, and the star with the most hearings is the one drawn.
describe('pickReachStar (#720)', () => {
  const star = (id, n, senders = [id]) => ({ id, origin: node, points: Array.from({ length: n }, (_, i) => ({ sender_id: senders[i % senders.length] })) })
  const key = 'db11db11f7808b97' + 'a'.repeat(48)
  it('takes the star with the most hearings when one row picks two', () => {
    const stars = [star(key, 3), star('db11db11f7808b97', 5), star('ffee0011', 4)]
    expect(pickReachStar(stars, new Set(['db11db11f7808b97', key]))).toEqual({ star: stars[1] })
  })
  it('counts two repeaters picked apart as two', () => {
    const stars = [star(key, 3), star('ffee0011', 4)]
    expect(pickReachStar(stars, new Set([key, 'ffee0011']))).toEqual({ picked: 2 })
  })
  it('says none when nothing picked has a star', () => {
    expect(pickReachStar([star(key, 3)], new Set(['ffee0011']))).toEqual({ picked: 0 })
  })
})
