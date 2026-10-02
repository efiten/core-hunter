import { describe, it, expect } from 'vitest'
import { selectionModel, targetPositions, selectionTitle, heardNodes, selectionCellSize, selectionRes } from './exportselection.js'
import { hexCellAt, hexSizeForRes } from './hexgrid.js'
import { registryMatcher } from './nodelayer.js'
import { CELL_RES } from './exportheard.js'

// The third export: what the map's filters select, heard and not heard.
// It does not matter what kind of node was heard.

const rx = (lat, lon, rssi, sender = 'aa11', hunter = 'kas') => ({ lat, lon, rssi, sender_id: sender, hunter_name: hunter })
const cell = (lat, lon) => hexCellAt(lat, lon, CELL_RES)

describe('selectionModel', () => {
  it('gives each heard cell the tier of its strongest reception', () => {
    const m = selectionModel({ points: [rx(51.84, 5.86, -105), rx(51.8401, 5.8601, -78)], mapped: [] })
    expect(m.heard).toHaveLength(1)
    expect(m.heard[0]).toMatchObject({ id: cell(51.84, 5.86), rssi: -78, tier: 'hot' })
  })

  it('marks the cells the hunters drove through without a selected reception as not heard', () => {
    const points = [rx(51.84, 5.86, -90)]
    const mapped = [rx(51.84, 5.86, -95, 'bb22'), rx(51.87, 5.90, -95, 'bb22')]
    const m = selectionModel({ points, mapped })
    expect(m.silent.map((c) => c.id)).toEqual([cell(51.87, 5.90)])
  })

  it('counts the receptions, the cells heard and the share of the cells driven', () => {
    const points = [rx(51.84, 5.86, -90), rx(51.8401, 5.8601, -91), rx(51.86, 5.88, -100)]
    const mapped = [...points, rx(51.87, 5.90, -95, 'bb22'), rx(51.89, 5.92, -95, 'bb22')]
    const m = selectionModel({ points, mapped })
    expect(m.numbers).toEqual({ receptions: 3, heardCells: 2, drivenCells: 4, share: 50 })
  })

  it('leaves out a reception without a position', () => {
    const m = selectionModel({ points: [rx(51.84, 5.86, -90), { rssi: -80, sender_id: 'aa11' }], mapped: [{ rssi: -80 }] })
    expect(m.numbers).toMatchObject({ receptions: 1, heardCells: 1, drivenCells: 1 })
  })

  it('has nothing heard and a share of 0 when the filters select nothing', () => {
    const m = selectionModel({ points: [], mapped: [rx(51.84, 5.86, -90, 'bb22')] })
    expect(m.heard).toEqual([])
    expect(m.numbers.share).toBe(0)
    // Nothing in view at all: nothing driven either, and still a number.
    expect(selectionModel({ points: [], mapped: [] }).numbers.share).toBe(0)
  })
})

describe('targetPositions', () => {
  const nodes = [
    { pubkey: 'DB11db11f7808b97' + 'a'.repeat(48), name: 'Dikkeboom', lat: 51.84, lon: 5.86 },
    { pubkey: 'db12' + 'b'.repeat(60), name: 'Other', lat: 51.9, lon: 5.9 },
    { pubkey: 'ee77' + 'c'.repeat(60), lat: 51.7, lon: 5.7 },
  ]
  const place = (ids) => targetPositions(ids, registryMatcher(nodes))
  it('places a target on the one node its id starts', () => {
    expect(place(['db11db11f7808b97'])).toEqual([{ id: nodes[0].pubkey.toLowerCase(), pick: 'db11db11f7808b97', name: 'Dikkeboom', lat: 51.84, lon: 5.86 }])
  })
  it('leaves out a target that starts no node, or more than one', () => {
    expect(place(['ffee0011aabb'])).toEqual([])
    expect(place(['db1'])).toEqual([])
  })
  // AGENTS.md §7: a relay id is placed by reach, per hearing, never by the
  // one key in view it happens to start.
  it('does not place a relay id of 1 to 3 bytes, even on the one node it starts', () => {
    expect(place(['ee'])).toEqual([])
    expect(place(['ee77cc'])).toEqual([])
  })
  it('reads a nameless node by its key\'s prefix, never as "undefined"', () => {
    expect(place(['ee77cccccccc'])[0].name).toBe('ee77cccc')
  })
})

// The export's cells are finer than the map's on purpose (Kasper, 30
// September 2026): the sizes by zoom the app's bands gave before #734, as a
// size, so a change to the grid's table does not change the picture.
describe('the selection export\'s cell', () => {
  const mapCell = (z) => (14 * 156543.03392) / 2 ** z   // the server's size at Leaflet zoom z
  it('is the size of the app\'s old band at the map\'s zoom', () => {
    expect(selectionCellSize(11)).toBe(180)
    expect(selectionCellSize(14)).toBe(90)
    expect(selectionCellSize(19)).toBe(3)
    expect(selectionCellSize(2)).toBe(1500)
  })
  it('is finer than the cell the map draws, at every zoom', () => {
    for (let z = 3; z <= 18; z++) expect(selectionCellSize(z), `zoom ${z}`).toBeLessThan(mapCell(z))
  })
  it('is binned at the resolution closest to that size', () => {
    for (let z = 3; z <= 19; z++) {
      const off = (res) => Math.abs(hexSizeForRes(res) - selectionCellSize(z))
      for (let res = 0; res <= 21; res++) expect(off(selectionRes(z)), `zoom ${z} res ${res}`).toBeLessThanOrEqual(off(res))
    }
  })
})

describe('selectionTitle', () => {
  it('names the picture after the targets, then the types and id sizes, in the bar\'s words', () => {
    expect(selectionTitle({ names: ['NL-NIJ-Dikkeboom', 'NL-NIJ-NIMBUS'] })).toBe('NL-NIJ-Dikkeboom + NL-NIJ-NIMBUS')
    expect(selectionTitle({ types: 'GroupText', idClasses: '1b' })).toBe('Channel · 1 byte')
    expect(selectionTitle({ names: ['NL-NIJ-Dikkeboom'], types: 'GroupData,Advert' })).toBe('NL-NIJ-Dikkeboom · Channel data · Advert')
  })
  it('calls the picture everything heard when nothing narrows it', () => {
    expect(selectionTitle({})).toBe('Everything heard')
  })
  it('names a typed prefix and No path, which narrow the points too', () => {
    expect(selectionTitle({ prefix: 'db1', noPath: true })).toBe('Starts with db1 · No path')
    expect(selectionTitle({ names: ['Dikkeboom'], noPath: true, types: 'Advert' })).toBe('Dikkeboom · No path · Advert')
  })
})

describe('heardNodes', () => {
  const dikkeboom = { pubkey: 'DB11' + 'a'.repeat(60), name: 'Dikkeboom', lat: 51.84, lon: 5.86 }
  const nimbus = { pubkey: '23f8' + 'b'.repeat(60), name: 'Nimbus', lat: 51.85, lon: 5.87 }
  // A 1-byte relay hash is placed by reach, anything else by its key.
  const attributionOf = (p) => (p.sender_id.length === 2 ? (p.sender_id === 'db' ? { rule: 'node', node: dikkeboom } : { rule: 'collision', count: 2 }) : null)
  const registryNodeOf = (p) => (p.sender_id.startsWith('23f8') ? nimbus : null)
  it('counts the receptions placed on each node, by reach or by key', () => {
    const pts = [rx(51.84, 5.86, -90, 'db'), rx(51.84, 5.86, -91, 'db'), rx(51.84, 5.86, -92, '23f8c8cb64e1aa97'), rx(51.84, 5.86, -93, 'e0')]
    expect(heardNodes(pts, { attributionOf, registryNodeOf })).toEqual([
      { id: dikkeboom.pubkey.toLowerCase(), name: 'Dikkeboom', lat: 51.84, lon: 5.86, n: 2 },
      { id: nimbus.pubkey, name: 'Nimbus', lat: 51.85, lon: 5.87, n: 1 },
    ])
  })
  it('names a node without a registry name by its prefix', () => {
    const nameless = { pubkey: 'C0FFEE' + 'c'.repeat(58), lat: 51.8, lon: 5.8 }
    expect(heardNodes([rx(51.84, 5.86, -90, 'c0ffee')], { attributionOf: () => null, registryNodeOf: () => nameless })[0].name).toBe('c0ffeecc')
  })
  it('places nothing where reach finds two candidates, even if a key would match', () => {
    const pts = [rx(51.84, 5.86, -90, 'e0')]
    expect(heardNodes(pts, { attributionOf, registryNodeOf: () => dikkeboom })).toEqual([])
  })
})
