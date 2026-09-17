// Pure logic for the node-position layer (#197): which registry nodes are in
// view, and how a node's advertised position should be drawn against our own
// RSSI estimate. No DOM, no Leaflet — the layer glue lives in map.js.
//
// DUPLICATED from app/src/nodelayer.js. #238 asked whether to extract the two
// copies into one shared module; the answer (2026-08-15, recorded in the header
// of web/parity.test.js) is no — neither deploy path can ship a file outside
// its own directory, since the app image builds with `app/` as its Docker
// context and the website deploys as a flat file list. So the copies stay, and
// parity.test.js is what makes a silent drift impossible rather than merely
// unlikely. It pins what the two share, including how a reception pairs with a
// registry node (senderIdMatches, groupSenderPointsForNodes, since #661). The
// web side also has functions the app has no use for (nodeRows, padBounds),
// and those are intentional, not drift.
//
// The registry position is what the node itself advertised (appData.location),
// relayed via the name resolver. It is operator-self-reported, so a gap between
// it and our estimate is called "drift", never "error": it does not imply our
// estimate is the wrong one.
import { haversineM, dedupeSpatial, rejectOutliers, weightedCentroid, geometryStats } from './locate.js'

const M_PER_DEG_LAT = 111320

// Below this the two positions are treated as agreeing, and no circle is drawn.
export const TIGHT_DRIFT_M = 100

// searchRadiusM is the RSSI-weighted RMS distance from the estimate back to the
// hunter's own reception points — it measures how spread out *our sampling* was,
// not how accurate the estimate is. A tight cluster of readings taken far from a
// node yields a small radius around a badly wrong estimate. encirclement (the
// fraction of 8 azimuth sectors containing a reading) is the existing
// counterweight, and 0.5 is already the app's one-sided cutoff — the same
// threshold behind the Locate box's "One-sided — walk/drive around" warning.
// Below it we make no accuracy claim and fall back to a plain drift circle.
export const TRUSTED_ENCIRCLEMENT = 0.5

function isCoord(v) { return typeof v === 'number' && Number.isFinite(v) }

// inBounds tests a {lat, lon} against a map viewport box (edges inclusive).
export function inBounds(pos, bounds) {
  if (!pos || !bounds) return false
  if (!isCoord(pos.lat) || !isCoord(pos.lon)) return false
  return pos.lat >= bounds.minLat && pos.lat <= bounds.maxLat
    && pos.lon >= bounds.minLon && pos.lon <= bounds.maxLon
}

// nodesInView narrows the bulk-fetched registry to the nodes worth drawing for
// the current viewport. The registry is fetched whole and filtered here rather
// than queried per node, per AGENTS.md §7's no-per-packet-API-calls rule.
export function nodesInView(nodes, bounds) {
  if (!Array.isArray(nodes) || !bounds) return []
  return nodes.filter((n) => inBounds(n, bounds))
}

// padBounds widens a map box by km on every side, in the map's own shape
// ({ south, west, north, east }, mapcore.js getBounds). The registry slice a
// draw asks for is the view padded by the reach (#661): a node just outside
// the view can be the one candidate for a reception inside it, or the second
// one that makes it a collision. A kilometre spans the most degrees of
// longitude nearest a pole, so the east-west pad is worked out at the padded
// box's poleward edge.
export function padBounds({ south, west, north, east }, km) {
  const dLat = (km * 1000) / M_PER_DEG_LAT
  const poleward = Math.max(Math.abs(south - dLat), Math.abs(north + dLat))
  const dLon = (km * 1000) / (M_PER_DEG_LAT * Math.cos((poleward * Math.PI) / 180))
  return { south: south - dLat, west: west - dLon, north: north + dLat, east: east + dLon }
}

// drawableNodes keeps the registry rows that can actually be plotted: a pubkey
// to attribute them to, and a finite position. A registry can answer with
// plenty of nodes and no coordinates at all — /api/nodes/positions drops those
// server-side, but a node whose coordinates arrive as null over any other path
// is indistinguishable from an empty registry as far as the map is concerned.
// Ported from app/src/nodelayer.js (#307), unchanged.
export function drawableNodes(nodes) {
  if (!Array.isArray(nodes)) return []
  return nodes.filter((n) => n && n.pubkey && isCoord(n.lat) && isCoord(n.lon))
}

// driftPresentation decides how one node is drawn, given its advertised
// position and our locate() result for it. Returns a `kind` plus, where both
// positions exist, the drift distance and which circle (if any) to draw:
//
//   none            neither position — draw nothing
//   advertised-only registry position, no usable estimate
//   estimate-only   an estimate, but the node never advertised a position
//   tight           drift <= TIGHT_DRIFT_M — the positions agree, no circle
//   drifted         drift is larger and the geometry is trusted — draw the
//                   search radius; outsideCircle marks a genuine conflict
//   unverified      drift is larger but the sampling was one-sided — draw a
//                   drift circle and make no accuracy claim
export function driftPresentation({ advertised, estimate }) {
  const centroid = estimate && estimate.centroid ? estimate.centroid : null
  const hasAdvertised = !!advertised && isCoord(advertised.lat) && isCoord(advertised.lon)

  if (!hasAdvertised && !centroid) return { kind: 'none' }
  if (!centroid) return { kind: 'advertised-only' }
  if (!hasAdvertised) return { kind: 'estimate-only' }

  const driftM = haversineM(advertised, centroid)
  if (driftM <= TIGHT_DRIFT_M) return { kind: 'tight', driftM, circle: null, outsideCircle: false }

  const stats = estimate.stats || {}
  const trusted = (stats.encirclement ?? 0) >= TRUSTED_ENCIRCLEMENT && isCoord(stats.searchRadiusM)
  if (trusted) {
    return {
      kind: 'drifted',
      driftM,
      circle: { kind: 'search', radiusM: stats.searchRadiusM },
      outsideCircle: driftM > stats.searchRadiusM,
    }
  }
  return {
    kind: 'unverified',
    driftM,
    circle: { kind: 'drift', radiusM: driftM },
    outsideCircle: false,
  }
}

// senderIdMatches checks if a sender_id (from a reception) matches a pubkey
// (from registry position). Full advert_pubkey must match exactly (64-hex).
// Discover pubkey prefix matches if it's a prefix of the full key. Relay,
// direct_hash, and channel_name are not matched here.
// Which sender kinds this matcher compares against a pubkey. advert carries the
// full pubkey and discover carries a prefix of it. A channel name is another
// namespace entirely. A relay, path or direct hash is a short prefix of the
// sending node's key, but whether it names one node depends on where it was
// heard, which a comparison with one key cannot see: it reaches a node only
// through its attribution by reach (#661, attribution.js), never through here.
export function isRegistryIdKind(senderKind) {
  return senderKind === 'advert_pubkey' || senderKind === 'discover_pubkey'
}

export function senderIdMatches(senderId, senderKind, nodePubkey) {
  if (!senderId || !nodePubkey) return false
  if (!isRegistryIdKind(senderKind)) return false
  const id = String(senderId).toLowerCase()
  const key = String(nodePubkey).toLowerCase()
  // An advert carries the whole key, so it must match exactly.
  if (senderKind === 'advert_pubkey') return id === key
  // A discover reply carries a prefix, matched from 2 bytes. A discover key
  // keeps this rule; attribution by reach covers relay ids only (#661).
  return id.length >= 4 && key.startsWith(id)
}

// groupSenderPointsForNodes attributes receptions to registry nodes in ONE pass,
// and refuses any reception whose id matches more than one of them.
//
// The refusal is the point. A discover prefix is only 2+ bytes, so it can be a
// prefix of two different registry pubkeys at once: with a few hundred
// positioned nodes that is roughly even odds somewhere in the set. Asking each
// node independently "does this prefix start my key?" makes both of them answer
// yes, so the same receptions feed two estimates, two connectors and two drift
// figures, one of which measures a different node. There is no way to tell from
// the reception which node it came from, so the honest answer is neither: an
// ambiguous id contributes to nothing. Same rule the target-list merge settled
// on in #267, and the same thing resolve.go's `ambiguous` flag means.
//
// A relay, path or direct hash takes the other road (#661): attributionOf(r)
// answers its attribution by reach (attribution.js), worked out by the caller
// against every candidate node rather than the ones passed in. Placed on a
// node, the reception joins that node when it was passed in; a collision or an
// estimate joins nothing, since this layer draws registry nodes. Without
// attributionOf no such reception lands anywhere.
//
// A reception is compared only with the nodes whose key starts with the same
// two bytes (HEAD_HEX): an advert id is the whole key and a discover prefix is
// at least two bytes of it, so no other node can match. Comparing with every
// node passed in took 1.7 s for 25 000 synthetic receptions against 3 000
// nodes, 7 ms this way (2026-09-15); a zoomed-out map passes a slice that big.
//
// Returns Map<pubkey, points[]>, with an entry for every node passed in.
const HEAD_HEX = 4
export function groupSenderPointsForNodes(records, nodes, { attributionOf = () => null } = {}) {
  const out = new Map()
  const byHead = new Map()
  for (const n of nodes || []) {
    const k = n && n.pubkey ? String(n.pubkey).toLowerCase() : null
    if (!k) continue
    out.set(k, [])
    const head = k.slice(0, HEAD_HEX)
    if (!byHead.has(head)) byHead.set(head, [])
    byHead.get(head).push(k)
  }
  if (!Array.isArray(records) || out.size === 0) return out

  for (const r of records) {
    if (!r || r.sender_id == null) continue
    if (!isCoord(r.lat) || !isCoord(r.lon)) continue
    const attr = attributionOf(r)
    if (attr) {
      const bucket = attr.rule === 'node' ? out.get(String(attr.node.pubkey).toLowerCase()) : null
      if (bucket) bucket.push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
      continue
    }
    if (!isRegistryIdKind(r.sender_kind)) continue
    let matched = null
    for (const k of byHead.get(String(r.sender_id).toLowerCase().slice(0, HEAD_HEX)) || []) {
      if (!senderIdMatches(r.sender_id, r.sender_kind, k)) continue
      if (matched !== null) { matched = null; break }   // ambiguous -> drop it
      matched = k
    }
    if (matched) out.get(matched).push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
  }
  return out
}

// estimateFor is locate() without the density grid: the layer needs a centroid
// and geometry stats per node, and densityGrid is O(cols*rows*points) — far too
// expensive to run for every node in view on every render tick. Same dedupe,
// outlier rejection and <3-inlier rule as locate(), so an estimate here agrees
// with the one Locate shows for the same sender.
export function estimateFor(points) {
  const { inliers } = rejectOutliers(dedupeSpatial(points || []))
  if (inliers.length < 3) return null
  const centroid = weightedCentroid(inliers)
  if (!centroid) return null
  return { centroid, stats: geometryStats(inliers, centroid), n: inliers.length }
}

// circleRing approximates a metre-radius circle as a closed ring of [lon, lat]
// pairs. MapLibre's circle layer sizes in screen pixels, so a ground-distance
// circle has to be drawn as a polygon that scales with the map instead.
export function circleRing(centre, radiusM, steps = 48) {
  if (!centre || !(radiusM > 0)) return []
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180)
  const ring = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    ring.push([
      centre.lon + (radiusM * Math.cos(a)) / mPerDegLon,
      centre.lat + (radiusM * Math.sin(a)) / M_PER_DEG_LAT,
    ])
  }
  ring.push(ring[0])
  return ring
}

// nodeRows turns one registry slice plus our own receptions into the rows the
// map draws: one per registry node, paired with an estimate where we have
// heard that node ourselves (#377).
//
// Which receptions pair is the app's rule since #661, which replaced the map's
// refusal to resolve a prefix to a node (#296). `bySender` is
// groupSenderPointsForNodes()'s Map, keyed by the lowercased pubkey: map.js
// builds it over the registry slice of the view padded by the reach
// (padBounds), so a second candidate just outside the view still refuses a
// relay id or a discover prefix, and hands this function the nodes in view.
export function nodeRows(nodes, bySender, estimate = estimateFor) {
  const rows = []
  for (const n of drawableNodes(nodes)) {
    const key = String(n.pubkey).toLowerCase()
    // estimateFor already answers null for an empty set, so there is no
    // no-receptions branch here — a node we never heard simply gets a null
    // estimate and driftPresentation calls it advertised-only.
    const est = estimate((bySender && bySender.get(key)) || [])
    const advertised = { lat: n.lat, lon: n.lon }
    rows.push({
      id: key,
      name: n.name || '',
      advertised,
      est,
      p: driftPresentation({ advertised, estimate: est }),
    })
  }
  return rows
}
