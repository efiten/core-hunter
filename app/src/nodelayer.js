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
