// Pure logic for the node-position layer (#197): which registry nodes are in
// view, and how a node's advertised position should be drawn against our own
// RSSI estimate. No DOM, no MapLibre — the layer glue lives in huntmap.js.
//
// The registry position is what the node itself advertised (appData.location),
// relayed via the name resolver. It is operator-self-reported, so a gap between
// it and our estimate is called "drift", never "error": it does not imply our
// estimate is the wrong one.
import { haversineM } from './locate.js'

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
