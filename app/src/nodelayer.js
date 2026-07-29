// Pure logic for the node-position layer (#197): which registry nodes are in
// view, and how a node's advertised position should be drawn against our own
// RSSI estimate. No DOM, no MapLibre — the layer glue lives in huntmap.js.
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
// direct_hash, and channel_name do not match registry nodes.
// Which sender kinds can name a registry node at all. advert carries the full
// pubkey and discover carries a prefix of it; relay path-hashes, 1-byte direct
// hashes and channel names are different namespaces entirely (see meshpacket.js)
// and must never be matched against a pubkey.
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
  // A discover reply carries a prefix. >= 2 bytes only; shorter is too
  // collision-prone to attribute at all.
  return id.length >= 4 && key.startsWith(id)
}

// groupSenderPointsForNodes attributes receptions to registry nodes in ONE pass,
// and refuses any reception whose id matches more than one of them.
//
// The refusal is the point. A discover prefix is only 2+ bytes, so it can be a
// prefix of two different registry pubkeys at once — with a few hundred
// positioned nodes that is roughly even odds somewhere in the set. Asking each
// node independently "does this prefix start my key?" makes both of them answer
// yes, so the same receptions feed two estimates, two connectors and two drift
// figures, one of which measures a different node. There is no way to tell from
// the reception which node it came from, so the honest answer is neither: an
// ambiguous id contributes to nothing. Same rule the target-list merge settled
// on in #267, and the same thing resolve.go's `ambiguous` flag means.
//
// Returns Map<pubkey, points[]>, with an entry for every node passed in.
export function groupSenderPointsForNodes(records, nodes) {
  const out = new Map()
  const keys = []
  for (const n of nodes || []) {
    const k = n && n.pubkey ? String(n.pubkey).toLowerCase() : null
    if (!k) continue
    out.set(k, [])
    keys.push(k)
  }
  if (!Array.isArray(records) || keys.length === 0) return out

  for (const r of records) {
    if (!r || r.sender_id == null) continue
    if (!isCoord(r.lat) || !isCoord(r.lon)) continue
    if (!isRegistryIdKind(r.sender_kind)) continue
    let matched = null
    for (const k of keys) {
      if (!senderIdMatches(r.sender_id, r.sender_kind, k)) continue
      if (matched !== null) { matched = null; break }   // ambiguous -> drop it
      matched = k
    }
    if (matched) out.get(matched).push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
  }
  return out
}


// groupSenderPoints buckets located receptions by sender so each node can be
// estimated independently. Receptions without a sender or a GPS fix carry no
// location information and are dropped.
export function groupSenderPoints(records) {
  const out = new Map()
  if (!Array.isArray(records)) return out
  for (const r of records) {
    if (r.sender_id == null) continue
    if (!isCoord(r.lat) || !isCoord(r.lon)) continue
    const key = String(r.sender_id).toLowerCase()
    if (!out.has(key)) out.set(key, [])
    out.get(key).push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
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
