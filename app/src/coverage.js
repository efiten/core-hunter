// The coverage overview (#603): every repeater's reach, all at once, each in a
// hue of its own. Pure: which hearings belong to which repeater, which hue a
// repeater gets, how strong a ray is drawn, and the GeoJSON the map draws.
// No DOM, no MapLibre; the layer glue lives in huntmap.js and web/map.js.
// Copied whole between app/src/ and web/ (parity.test.js), since neither
// deploy path can ship a file outside its own directory (#238).
import { estimateFor } from './nodelayer.js'

// Attribution is classifyReception's rule (AGENTS.md §1): the originator at
// zero hops, or the last relay of a flood. On the record that is a Repeater
// role, a relay hash, a Discover reply or a trace reply. The same test as the
// feed's repeater rule, plus the Discover reply, which is the node itself
// answering our ask. Same caveat as Locate (#320): the identity is
// unauthenticated, and a forged sender id inflates that repeater's star.
export function isRepeaterHearing(pt) {
  if (!pt) return false
  return pt.sender_role === 'Repeater' || pt.sender_kind === 'relay'
    || pt.sender_kind === 'discover_pubkey' || pt.sender_kind === 'trace_reply'
}

// A hearing where the repeater also heard us: a Discover or trace reply to
// our own ask (#481/#482). It proves the link works both ways from that spot,
// which overhearing a relay does not.
export function isTwoWay(pt) {
  return !!pt && (pt.sender_kind === 'discover_pubkey' || pt.sender_kind === 'trace_reply')
}

// The palette: HUE_COUNT hues as --ch-hue-<n> tokens (tokens.css), one per
// slot. Twelve is the most that stay apart on a dark basemap; a raw hash over
// more slots gives near-twins next to each other.
export const HUE_COUNT = 12

// The slot an id hashes to. FNV-1a over the lower-cased id: stable across
// sessions, zoom levels and between the app and the map, and the same
// pubkey in either case lands on one slot.
export function hueSlot(id) {
  const s = String(id ?? '').toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // A final mix before the modulo: FNV's low bits carry the last characters'
  // pattern, and HUE_COUNT is small, so without it two ids that differ in a
  // regular way land in a regular way.
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h = (h ^ (h >>> 16)) >>> 0
  return h % HUE_COUNT
}

// Two repeaters closer than this are neighbours whose hues must differ: the
// hand-over question is asked between neighbours, and two stars in one hue
// there read as one. Two kilometres is under a repeater's usual spacing in
// town and over the distance at which two masts share a view.
export const NEAR_M = 2000
// Equirectangular metres, enough for a 2 km neighbour test; the locate maths
// lives under a different path on each side (#238), so nothing is imported.
const M_PER_DEG = 111320
function metresBetween(a, b) {
  const dLat = (a.lat - b.lat) * M_PER_DEG
  const dLon = (a.lon - b.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLon)
}

// assignHues gives every node a slot: the hash slot when no neighbour within
// NEAR_M already holds it, else the next free one walking up. Nodes are
// taken in id order, so the outcome does not depend on fetch or draw order,
// and a node with no position cannot collide with anyone: it keeps its hash.
// Returns Map id (lower-cased) -> slot.
export function assignHues(nodes) {
  const rows = (nodes || []).filter((n) => n && n.id != null)
    .map((n) => ({ id: String(n.id).toLowerCase(), lat: n.lat, lon: n.lon }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const placed = []
  const out = new Map()
  const near = (a, b) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && Number.isFinite(b.lat) && Number.isFinite(b.lon)
    && metresBetween(a, b) < NEAR_M
  for (const n of rows) {
    if (out.has(n.id)) continue
    const base = hueSlot(n.id)
    let slot = base
    for (let step = 0; step < HUE_COUNT; step++) {
      slot = (base + step) % HUE_COUNT
      if (!placed.some((p) => p.slot === slot && near(p, n))) break
    }
    out.set(n.id, slot)
    placed.push({ ...n, slot })
  }
  return out
}

// The legend's scale: a ray at -120 dBm is the faintest and thinnest drawn,
// one at -60 the brightest and widest. Not signal.js's tier bands: the tiers
// are six steps for the thermal palette, and a ray wants a continuous ramp.
export const RAY_WEAK_DBM = -120
export const RAY_STRONG_DBM = -60
export function rayStrength(rssi) {
  if (rssi == null || rssi === '') return 0
  const v = Number(rssi)
  if (!Number.isFinite(v)) return 0
  const f = (v - RAY_WEAK_DBM) / (RAY_STRONG_DBM - RAY_WEAK_DBM)
  return Math.min(1, Math.max(0, f))
}

// One-way hearings draw the same ray at reduced opacity, so they recede
// behind the two-way ones without a second shape (Kasper, 2026-09-08). With
// a selection, every other star drops to DIM_OPACITY in its own hue, so the
// hand-over to the neighbours stays readable.
export const ONE_WAY_OPACITY = 0.4
export const DIM_OPACITY = 0.25
const RAY_MIN_W = 0.8, RAY_MAX_W = 3.2
const RAY_MIN_OP = 0.3, RAY_MAX_OP = 0.95
export function rayStyle(rssi, { twoWay = true, dimmed = false } = {}) {
  const s = rayStrength(rssi)
  const w = Math.round((RAY_MIN_W + s * (RAY_MAX_W - RAY_MIN_W)) * 100) / 100
  let op = RAY_MIN_OP + s * (RAY_MAX_OP - RAY_MIN_OP)
  if (!twoWay) op *= ONE_WAY_OPACITY
  if (dimmed) op *= DIM_OPACITY
  return { w, op: Math.round(op * 1000) / 1000 }
}

// The hub: the registry's advertised position when there is one (▲), else the
// RSSI estimate over the same hearings (●). A 0,0 is no position (the §9 trap).
export function starOrigin({ advertised, estimate } = {}) {
  const usable = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0)
  if (usable(advertised)) return { lat: advertised.lat, lon: advertised.lon, kind: 'advertised' }
  const c = estimate && estimate.centroid
  if (usable(c)) return { lat: c.lat, lon: c.lon, kind: 'estimate' }
  return null
}

// In 3D the ray leaves the mast rather than the ground: it starts this high
// above the repeater and lands at ground level at the hearing (Kasper,
// 2026-09-08), so the star reads as the signal coming down.
export const RAY_ALT_M = 30

// coverageStars groups the repeater hearings by id and hangs each star from
// its origin. positionOf(id) answers the registry's advertised position or
// null; estimate(points) is the node layer's estimateFor unless a test says
// otherwise. A star with no origin at all (no position, too few hearings for
// an estimate) is left out: there is nothing to draw it from.
export function coverageStars(points, { positionOf = () => null, estimate = estimateFor } = {}) {
  const byId = new Map()
  for (const pt of points || []) {
    if (!isRepeaterHearing(pt) || pt.sender_id == null) continue
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue
    const id = String(pt.sender_id).toLowerCase()
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(pt)
  }
  const out = []
  for (const [id, pts] of byId) {
    const advertised = positionOf(id) || null
    const est = estimate(pts.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi })))
    const origin = starOrigin({ advertised, estimate: est })
    if (!origin) continue
    out.push({ id, origin, points: pts })
  }
  return out
}

// coverageFeatures: one LineString per hearing, hub to hearing, with the
// repeater's hue and the ray's strength on the feature. `selected` is the set
// of selected ids; empty or absent means nothing is dimmed.
export function coverageFeatures(stars, { slotOf, colorOf, selected = null } = {}) {
  const dimming = !!(selected && selected.size)
  const features = []
  for (const s of stars || []) {
    const color = colorOf(slotOf(s.id))
    const dim = dimming && !selected.has(s.id)
    for (const pt of s.points) {
      const two = isTwoWay(pt)
      const { w, op } = rayStyle(pt.rssi, { twoWay: two, dimmed: dim })
      features.push({ type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[s.origin.lon, s.origin.lat], [pt.lon, pt.lat]] },
        properties: { id: s.id, color, op, w, two, dim, alt: RAY_ALT_M, hub: s.origin.kind } })
    }
  }
  return { type: 'FeatureCollection', features }
}
