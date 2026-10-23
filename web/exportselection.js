// The third export: what the map's filters select (targets, time window,
// hunters, packet types) in cells finer than the map's (selectionCellSize).
// Where it was heard, in the tier
// of the strongest reception per cell, and where the same hunters drove
// without hearing it. It does not matter what kind of node was heard, and
// nothing is filled in: without one repeater there is no origin to think
// from, as #720 does (exportreach.js).
import { hexCellAt, hexBoundary } from './hexgrid.js'
import { rssiTier } from './signal.js'
import { CELL_RES, idLabel, isHashId, resForSize } from './exportheard.js'
import { FILTER_PACKET_TYPES, SENDER_ID_CLASSES } from './packettypes.js'

const ringOf = (id) => hexBoundary(id).map(([lat, lon]) => [lon, lat])
const placed = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)

// The cell size, in Mercator units from centre to corner, by the map's
// Leaflet zoom: the sizes the app's zoom bands gave before #734. Finer than
// the cells the map draws, on purpose (Kasper, 30 September 2026): about a
// sixth of a map cell across at zoom 11 and two thirds at zoom 14, so a
// picture of a drive shows the street it was heard on. Kept as sizes, so a
// change to the grid's table does not change the picture.
const SELECTION_CELL = [[19, 3], [18, 5], [17, 10], [16, 20], [15, 40], [13, 90], [11, 180], [9, 360], [7, 720], [-Infinity, 1500]]
export function selectionCellSize(leafletZoom) {
  return SELECTION_CELL.find(([z]) => leafletZoom >= z)[1]
}
export const selectionRes = (leafletZoom) => resForSize(selectionCellSize(leafletZoom))

// selectionModel: `points` are the receptions the filters select; `mapped`
// every reception of the hunters who heard any of them, in the same window,
// for the cells they drove through; `nodes` the nodes to draw: the picked
// targets and the nodes the receptions were placed on (heardNodes).
export function selectionModel({ points, mapped, nodes = [], res = CELL_RES }) {
  const best = new Map()
  for (const p of points) {
    if (!placed(p)) continue
    const id = hexCellAt(p.lat, p.lon, res)
    const b = best.get(id)
    if (!b || p.rssi > b.rssi) best.set(id, p)
  }
  const heard = [...best].map(([id, p]) => ({ id, ring: ringOf(id), rssi: p.rssi, tier: rssiTier(p.rssi) }))
  const driven = new Set(best.keys())
  for (const p of mapped) if (placed(p)) driven.add(hexCellAt(p.lat, p.lon, res))
  const silent = [...driven].filter((id) => !best.has(id)).map((id) => ({ id, ring: ringOf(id) }))
  const dots = points.filter(placed).map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi, tier: rssiTier(p.rssi) }))
  return {
    heard, silent, dots, nodes,
    numbers: {
      receptions: dots.length,
      heardCells: heard.length,
      drivenCells: driven.size,
      share: driven.size ? Math.round((100 * heard.length) / driven.size) : 0,
    },
  }
}

// framedNumbers: the band's numbers for the frame the picture shows. The
// picture is fitted to the selected receptions, so a cell the hunters drove
// through elsewhere in the map's view is not drawn, and is not counted.
// inFrame(lat, lon) says whether a point is inside; a cell counts by its
// centre, the mean of its corners.
const centreOf = (ring) => {
  const c = ring.slice(0, 6)
  return { lon: c.reduce((a, [x]) => a + x, 0) / c.length, lat: c.reduce((a, [, y]) => a + y, 0) / c.length }
}
export function framedNumbers(model, inFrame) {
  const shown = (cell) => { const c = centreOf(cell.ring); return inFrame(c.lat, c.lon) }
  const heardCells = model.heard.filter(shown).length
  const drivenCells = heardCells + model.silent.filter(shown).length
  return {
    receptions: model.dots.filter((d) => inFrame(d.lat, d.lon)).length,
    heardCells,
    drivenCells,
    share: drivenCells ? Math.round((100 * heardCells) / drivenCells) : 0,
  }
}

// heardNodes: the registry nodes the receptions were placed on, with how
// many each. A relay hash of 1 to 3 bytes is placed by reach
// (attributeReception, #661), a key or a prefix of one by the node it alone
// starts (registryMatcher, #723): the same rules the map's layers use.
export function heardNodes(points, { attributionOf, registryNodeOf }) {
  const out = new Map()
  for (const p of points) {
    const reach = attributionOf(p)
    const node = reach ? (reach.rule === 'node' ? reach.node : null) : registryNodeOf(p)
    if (!node) continue
    const id = String(node.pubkey).toLowerCase()
    const had = out.get(id)
    if (had) had.n++
    else out.set(id, { id, name: node.name || idLabel(id), lat: node.lat, lon: node.lon, n: 1 })
  }
  return [...out.values()]
}

// targetPositions: the picked target ids the registry places, each on the
// one node it names by the rules the map pairs by (registryNodeOf, a
// registryMatcher): a key exactly, a prefix from 2 bytes when it starts one
// key only. A relay id of 1 to 3 bytes is placed by reach, per hearing
// (AGENTS.md §7), so it is never placed here; heardNodes carries it. `pick`
// is the id as picked, `id` the node's key.
export function targetPositions(ids, registryNodeOf) {
  const out = []
  for (const id of ids) {
    const pick = String(id).toLowerCase()
    if (isHashId(pick)) continue
    const node = registryNodeOf({ sender_id: pick, sender_kind: pick.length === 64 ? 'advert_pubkey' : 'discover_pubkey' })
    if (!node) continue
    const key = String(node.pubkey).toLowerCase()
    out.push({ id: key, pick, name: node.name || idLabel(key), lat: node.lat, lon: node.lon })
  }
  return out
}

// foldPicks: the picked ids, one per node. A merged target row picks every
// prefix its node was heard under (rowIds, #331), and the title names that
// node once. A pick placed on a node stands for that node's key; a pick that
// is not placed stands for itself, and is dropped when it is a prefix of
// another pick's key. Of the picks left on one key, the first is kept.
export function foldPicks(ids, targets) {
  const keyOf = (pick) => (targets.find((t) => t.pick === pick) || {}).id || pick
  const picks = ids.map((id) => String(id).toLowerCase())
  const keys = picks.map(keyOf)
  const seen = new Set()
  return ids.filter((id, i) => {
    const key = keys[i]
    const placed = key !== picks[i]
    if (!placed && keys.some((k) => k !== key && k.startsWith(key))) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// selectionTitle: what the picture shows, in the filter's own words: the
// targets by name or the typed prefix, No path, then the packet types and id
// sizes picked in the bar, with the bar's labels. Nothing picked is
// everything that was heard.
export function selectionTitle({ names = [], prefix = '', noPath = false, types = '', idClasses = '' }) {
  const label = (list, v) => (list.find((o) => o.value === v) || { label: v }).label
  const parts = [
    names.join(' + '),
    prefix ? `Starts with ${prefix}` : '',
    noPath ? 'No path' : '',
    ...String(types).split(',').filter(Boolean).map((v) => label(FILTER_PACKET_TYPES, v)),
    ...String(idClasses).split(',').filter(Boolean).map((v) => label(SENDER_ID_CLASSES, v)),
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Everything heard'
}
