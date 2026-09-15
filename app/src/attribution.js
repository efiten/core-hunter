// Attribution by reach (#661): which registry node a relayed reception belongs
// to. Pure, per reception. A relay id is a prefix of the relaying node's pubkey,
// and a short prefix is shared by many nodes, but a collision only matters when
// two of them are both within reach of where the reception was heard:
//
//   1. exactly one positioned registry node with that prefix within reach: the
//      reception belongs to that node (its advertised position, its name);
//   2. none, or no registry at all (a guest): an estimate over the receptions
//      that fall under this rule themselves;
//   3. two or more within reach: evidence of a collision, so no node, no
//      position and no name.
//
// The decision is docs/2026-09-15-attribution-by-reach.md, the rule AGENTS.md §7.
// Copied whole between app/src/ and web/ (parity.test.js), since neither deploy
// path can ship a file outside its own directory (#238). No imports: the
// geometry module sits under a different path on each side.

// Reach is the free-space distance at which a 1 W (30 dBm) transmitter with a
// 3 dBi antenna on both ends still arrives at the RSSI heard: 36 dB of budget
// against FSPL(dB) = 20 log10(km) + 20 log10(MHz) + 32.44. The frequency is
// assumed, because the app does not read the companion's: on 433 MHz the same
// signal can come from twice as far. The decision caps the reach at 15 km,
// whatever the budget allows for a weaker signal.
export const REACH_CAP_KM = 15
export const LINK_BUDGET_DB = 36
export const REACH_FREQ_MHZ = 868

// reachKm: -70 dBm is 5.5 km, -75 is 9.8 km, -79 and weaker the full 15 km.
// An RSSI that is not a number says nothing about distance: the full reach.
export function reachKm(rssiDbm) {
  if (typeof rssiDbm !== 'number' || !Number.isFinite(rssiDbm)) return REACH_CAP_KM
  const km = 10 ** ((LINK_BUDGET_DB - rssiDbm - 20 * Math.log10(REACH_FREQ_MHZ) - 32.44) / 20)
  return Math.min(REACH_CAP_KM, km)
}

// The ids the rule covers: a flood's last hop (relay, or path_hash at one byte)
// and a zero-hop source hash (direct_hash), at 1, 2 or 3 bytes. A longer relay
// id, an advert or discover key and a channel name keep their own rules.
const ATTRIBUTABLE_KINDS = new Set(['relay', 'path_hash', 'direct_hash'])
const SHORT_ID = /^(?:[0-9a-f]{2}|[0-9a-f]{4}|[0-9a-f]{6})$/i
export function attributableId(rec) {
  if (!rec || !ATTRIBUTABLE_KINDS.has(rec.sender_kind) || rec.sender_id == null) return null
  const id = String(rec.sender_id)
  return SHORT_ID.test(id) ? id.toLowerCase() : null
}

// registryIndex files every positioned node under its 2, 4 and 6-hex prefix,
// once per registry change rather than once per reception. A node without a
// position is left out: reach cannot place it, so it is no candidate. The same
// pubkey listed twice (two registries, two letter cases) is one node.
export function registryIndex(nodes) {
  const byPrefix = new Map()
  const seen = new Set()
  for (const n of nodes || []) {
    if (!n || !n.pubkey || !isCoord(n.lat) || !isCoord(n.lon)) continue
    const key = String(n.pubkey).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    for (const len of [2, 4, 6]) {
      const p = key.slice(0, len)
      if (!byPrefix.has(p)) byPrefix.set(p, [])
      byPrefix.get(p).push(n)
    }
  }
  return { byPrefix }
}

// attributeReception applies the rule to one reception. offsetDb is the plot
// offset (calibration, plus the attenuator's loss added back), so the reach
// follows the RSSI the map plots. Returns null for a kind the rule does not
// cover, else { rule: 'node', node } | { rule: 'collision', count } |
// { rule: 'estimate', prefixKnown }. prefixKnown says the registry holds a
// positioned node with that prefix out of reach: evidence that a resolver's
// name for the id belongs to a node that was not heard here.
export function attributeReception(rec, { index = null, offsetDb = 0 } = {}) {
  const id = attributableId(rec)
  if (id == null) return null
  const candidates = index ? index.byPrefix.get(id) || [] : []
  const inReach = candidates.filter((n) => withinReach(rec, n, { offsetDb }))
  if (inReach.length === 1) return { rule: 'node', node: inReach[0] }
  if (inReach.length >= 2) return { rule: 'collision', count: inReach.length }
  return { rule: 'estimate', prefixKnown: candidates.length > 0 }
}

// withinReach: whether a position ({ lat, lon }) is within the reach of the
// reception's RSSI plus offsetDb, the test a candidate passes for rule 1. A
// reach edge counts as within.
export function withinReach(rec, pos, { offsetDb = 0 } = {}) {
  const rssi = rec.rssi == null ? NaN : Number(rec.rssi) + offsetDb
  return kmBetween(rec, pos) <= reachKm(rssi)
}

// attributionSignature: equal exactly when two attributions read the same, so
// a surface can tell that a row needs a repaint without comparing objects.
export function attributionSignature(attr) {
  if (!attr) return ''
  if (attr.rule === 'node') return 'node:' + String(attr.node.pubkey).toLowerCase()
  if (attr.rule === 'estimate') return attr.prefixKnown ? 'estimate:known' : 'estimate'
  return attr.rule
}

function isCoord(v) { return typeof v === 'number' && Number.isFinite(v) }

// Equirectangular kilometres, enough at a 15 km reach (coverage.js does the same
// for its 2 km neighbour test).
const M_PER_DEG = 111320
function kmBetween(a, b) {
  const dLat = (a.lat - b.lat) * M_PER_DEG
  const dLon = (a.lon - b.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLon) / 1000
}
