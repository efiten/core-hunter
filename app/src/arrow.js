// The direction arrow (#660): which way the sender of the shown reception is,
// relative to where you are heading, on the HUD and the float readout. Pure;
// app.js keeps the heading, the fix and the target and draws the result.
//
// The target is the last hop: the originator at zero hops, a flood's last relay
// otherwise (classifyReception). Its position follows the attribution by reach
// (#661): a reception placed on a node points at that node's advertised
// position, a collision points nowhere, and anything else takes the registry's
// position for its id when there is one and the estimate over the receptions
// of that id that fall under rule 2 when there is not. Filled for advertised,
// outlined for an estimate. No distance: the arrow says which way, not how far.
// App-only: the map has no heading and no shown reception.
import { isValidFix } from './gps.js'
import { isGpsStalled } from './lifecycle.js'
import { starKey, starOrigin } from './coverage.js'
import { estimateFor } from './nodelayer.js'

const toRad = (d) => (d * Math.PI) / 180

// bearingDeg: the initial great-circle bearing from one { lat, lon } to another,
// in degrees clockwise from true north, 0 to 360.
export function bearingDeg(from, to) {
  const f1 = toRad(from.lat), f2 = toRad(to.lat)
  const dl = toRad(to.lon - from.lon)
  const y = Math.sin(dl) * Math.cos(f2)
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// relativeAngle: how far to turn from the heading to the bearing, the short way,
// in (-180, 180]. 0 is straight ahead, positive is to the right.
export function relativeAngle(bearing, heading) {
  const d = (((bearing - heading) % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

// A compass reading older than this is no heading: the page stopped receiving
// orientation events (hidden, or the sensor went quiet).
export const COMPASS_STALE_MS = 2000

// headingFor: the heading the arrow turns against. The source follows the
// speed the way the map's heading mode does (autoSource, #403): the GPS course
// once driving, the compass below that. The course is null until a fix
// carries one; a compass reading counts only while it is fresh.
export function headingFor({ source, course, compass, now }) {
  if (source === 'course') return Number.isFinite(course) ? course : null
  if (source === 'device') {
    return compass && Number.isFinite(compass.deg) && now - compass.at <= COMPASS_STALE_MS ? compass.deg : null
  }
  return null
}

// arrowFor: the arrow to draw, or null for no arrow at all. It needs a target,
// a valid fix that is not stale and a heading; without any of those the arrow
// would point somewhere it cannot know, so nothing is drawn in its place.
export function arrowFor({ target, fix, lastFixAt, heading, now }) {
  if (!target || !isValidFix(fix) || isGpsStalled(lastFixAt, now) || !Number.isFinite(heading)) return null
  return { angle: relativeAngle(bearingDeg(fix, target), heading), kind: target.kind }
}

// The kinds whose id is a node's own key or a prefix of it: an advert carries
// the whole key, a Discover reply and a trace or telemetry reply come from a
// node we asked, by its key or a prefix of it.
const REGISTRY_KINDS = new Set(['advert_pubkey', 'discover_pubkey', 'trace_reply', 'telemetry_reply'])

// registryMatch: the one registry node whose key starts with the reception's
// id, for those kinds, from 2 bytes up. Two nodes sharing the prefix name
// neither. `index` is attribution.js's registryIndex.
export function registryMatch(rec, index) {
  if (!rec || !index || !REGISTRY_KINDS.has(rec.sender_kind) || rec.sender_id == null) return null
  const id = String(rec.sender_id).toLowerCase()
  if (id.length < 4) return null
  const bucket = index.byPrefix.get(id.slice(0, 6)) || []
  const hits = bucket.filter((n) => String(n.pubkey).toLowerCase().startsWith(id))
  return hits.length === 1 ? hits[0] : null
}

// arrowTarget: where the arrow points for a reception, { lat, lon, kind } or
// null. `rows` are the receptions the estimate may use (the plot window), each
// carrying its attribution as _attr. A channel name is a display name, not a
// node, so it has no position.
export function arrowTarget(rec, { index = null, rows = [] } = {}) {
  if (!rec || rec.sender_id == null || rec.sender_kind === 'channel_name') return null
  const attr = rec._attr || null
  if (attr && attr.rule === 'collision') return null
  if (attr && attr.rule === 'node') return starOrigin({ advertised: attr.node })
  const advertised = registryMatch(rec, index)
  if (advertised) return starOrigin({ advertised })
  const key = starKey(rec, attr)
  const points = []
  for (const r of rows) {
    if (!r || r.sender_id == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue
    if (starKey(r, r._attr || null) === key) points.push({ lat: r.lat, lon: r.lon, rssi: r.rssi })
  }
  return starOrigin({ estimate: estimateFor(points) })
}

// arrowChanged: whether a redraw would show something different. The float
// readout redraws its whole canvas, so a turn under minDeg is not worth one.
export function arrowChanged(prev, next, minDeg) {
  if (!prev || !next) return !prev !== !next
  if (prev.kind !== next.kind) return true
  return Math.abs(relativeAngle(next.angle, prev.angle)) >= minDeg
}
