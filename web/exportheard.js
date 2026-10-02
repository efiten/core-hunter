// The "Repeaters heard" export (#666): the reach layer's stars as a
// 1200×1200 PNG, for passing on what a drive heard. This module decides what
// goes on the image; exportrender.js draws it.
//
// Decided with Kasper on 27 September 2026, on mockups from real data:
// every repeater in its own hue, as on the map (assignHues), and each ray's
// strength as a gradient within that hue, strong full and thick, weak lighter
// and thinner, with the width and opacity the map gives it (rayStyle). The
// cells driven through are grey, the route is grey, and a name is dropped
// where it would print over another, never the ▲.
import { assignHues, rayStyle, rayStrength } from './coverage.js'
import { hexCellAt, hexBoundary, hexSizeForRes } from './hexgrid.js'
import { haversineM } from './locate.js'
import { isHashIdKind } from './names.js'
import { TIER_BANDS } from './signal.js'

export const EXPORT_W = 1200
export const EXPORT_H = 1200
export const EXPORT_MAP_H = 1000

// A star whose nearest hearing is farther than this from where it hangs has a
// registry position that cannot be right: drawing it would stretch the map to
// fit a line to nowhere. It is left off and named in the band instead.
export const FAR_KM = 30

// A drive ends where the gap says another one began.
export const ROUTE_GAP_MS = 5 * 60e3
export const ROUTE_GAP_KM = 3

// The cell of #720's reference, by its size: 360 Mercator units from centre
// to corner, about 445 m point to point on the ground at 52°N. The resolution
// is whichever the grid gives closest to it: since #734 that is res 13, 268
// units, about 330 m point to point.
export const CELL_SIZE = 360
export const CELL_RES = closestRes(CELL_SIZE)
function closestRes(size) {
  let best = 0
  for (let res = 1; res <= 21; res++) if (Math.abs(hexSizeForRes(res) - size) < Math.abs(hexSizeForRes(best) - size)) best = res
  return best
}

// The map's own great-circle distance (locate.js), in km.
export const kmBetween = (a, b) => haversineM(a, b) / 1000

// idLabel: how an id without a registry name reads on the picture. A relay
// or direct hash is an id, never a name (AGENTS.md §5.4 item 6), so it reads
// as the ticker reads it, '#' and the id; a key reads as its 8-hex prefix.
// A hash is 1 to 3 bytes: a star keyed by a node's full key reads as a key,
// whatever kind of hearing placed it there. Without a kind (a picked
// target), a hash is known by its length alone.
export function isHashId(id, kind = null) {
  const s = String(id)
  return (kind ? isHashIdKind(kind) : true) && s.length <= 6
}
export function idLabel(id, kind = null) {
  const s = String(id)
  return isHashId(s, kind) ? '#' + s : s.slice(0, 8)
}

// fitText: a line cut to maxW with an ellipsis, for a band row that takes
// one line whatever it holds. measure(text) is the canvas's width in px.
export function fitText(text, maxW, measure) {
  if (measure(text) <= maxW) return text
  let s = text
  while (s.length && measure(s + '…') > maxW) s = s.slice(0, -1)
  return s + '…'
}

// starName: how a star is named on a picture. The registry's name first;
// the resolver's (cachedNameOf) for a key only, since a relay hash with no
// candidate in reach is not named by a resolver (AGENTS.md §7 rule 2);
// otherwise idLabel's reading.
export function starName(star, { nameOf = () => null, cachedNameOf = () => null } = {}) {
  const kind = star.points[0] && star.points[0].sender_kind
  return nameOf(star.id) || (!isHashId(star.id, kind) && cachedNameOf(star.id)) || idLabel(star.id, kind)
}

const inside = (v, p) => p.lat >= v.south && p.lat <= v.north && p.lon >= v.west && p.lon <= v.east

// nearestKm: how far a star hangs from its nearest hearing. Farther than
// FAR_KM, its position cannot be right (heardModel leaves it off, #720's
// export refuses it).
export function nearestKm(star) {
  return Math.min(...star.points.map((p) => kmBetween(star.origin, p)))
}

// tierLegend: the RSSI tiers as [tier, words], from the bands rssiTier
// draws by, so the legend on a picture cannot drift from the map's colours.
export function tierLegend() {
  const out = TIER_BANDS.map(([tier, floor], i) => [tier, i === 0 ? `≥ ${floor}` : `${TIER_BANDS[i - 1][1] - 1} … ${floor}`])
  out.push(['faint', `< ${TIER_BANDS[TIER_BANDS.length - 1][1]}`])
  return out
}

// heardModel: what the image draws, from the stars the map builds
// (coverageStars) and the view it has. A star is drawn when its origin is in
// view and its nearest hearing is within FAR_KM; the numbers count what is
// drawn. Each star is named by starName.
export function heardModel({ stars, view, nameOf = () => null, cachedNameOf = () => null }) {
  const drawn = []
  const offMap = []
  for (const s of stars || []) {
    if (!inside(view, s.origin)) continue
    const nearest = nearestKm(s)
    const name = starName(s, { nameOf, cachedNameOf })
    if (nearest > FAR_KM) { offMap.push({ name, km: Math.round(nearest) }); continue }
    drawn.push({
      id: s.id, name, origin: s.origin, n: s.points.length,
      rays: s.points.map((p) => ({ lon: p.lon, lat: p.lat, rssi: p.rssi, s: rayStrength(p.rssi), ...rayStyle(p.rssi) })),
    })
  }
  const hues = assignHues(drawn.map((s) => ({ id: s.id, lat: s.origin.lat, lon: s.origin.lon })))
  for (const s of drawn) s.slot = hues.get(s.id)
  const receptions = drawn.reduce((n, s) => n + s.rays.length, 0)
  const farthestKm = drawn.reduce((m, s) => Math.max(m, ...s.rays.map((r) => kmBetween(s.origin, r))), 0)
  return { drawn, offMap, numbers: { repeaters: drawn.length, receptions, farthestKm } }
}

// routeSegments: the receptions of the hunters in time order, as [lon, lat]
// lines, broken where more than ROUTE_GAP_MS passes, the position jumps more
// than ROUTE_GAP_KM, or the hunter changes. A one-point segment draws nothing
// and is dropped.
export function routeSegments(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.rx_at)
    .slice().sort((a, b) => (a.hunter_name === b.hunter_name ? (a.rx_at < b.rx_at ? -1 : a.rx_at > b.rx_at ? 1 : 0) : String(a.hunter_name) < String(b.hunter_name) ? -1 : 1))
  const out = []
  let cur = []
  let prev = null
  for (const p of pts) {
    const gap = prev && (Date.parse(p.rx_at) - Date.parse(prev.rx_at) > ROUTE_GAP_MS || kmBetween(prev, p) > ROUTE_GAP_KM || prev.hunter_name !== p.hunter_name)
    if (gap) { if (cur.length > 1) out.push(cur); cur = [] }
    cur.push([p.lon, p.lat])
    prev = p
  }
  if (cur.length > 1) out.push(cur)
  return out
}

// mappedCells: one export cell (CELL_RES) per place a reception was taken, as a closed
// [lon, lat] ring.
export function mappedCells(points, res = CELL_RES) {
  const ids = new Set()
  for (const p of points || []) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) ids.add(hexCellAt(p.lat, p.lon, res))
  const out = []
  for (const id of ids) {
    const ring = hexBoundary(id)
    if (ring) out.push(ring.map(([lat, lon]) => [lon, lat]))
  }
  return out
}

// placeLabels: which names fit. Most-heard first, so a busy repeater keeps
// its name over a quiet one; a name is dropped when its box, grown by
// `margin`, meets a name already placed, or when it runs off the image. The
// name starts `dx` right of its glyph and is centred on it. Returns the ids.
export function placeLabels(items, { measure, width, height, dx = 12, lineHeight = 16, margin = 4 }) {
  const placed = []
  const kept = new Set()
  const order = [...items].sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))
  for (const it of order) {
    const w = measure(it.label)
    const box = { left: it.x + dx, right: it.x + dx + w, top: it.y - lineHeight / 2, bottom: it.y + lineHeight / 2 }
    if (box.right > width || box.top < 0 || box.bottom > height) continue
    const grown = { left: box.left - margin, right: box.right + margin, top: box.top - margin, bottom: box.bottom + margin }
    if (placed.some((q) => grown.left < q.right && grown.right > q.left && grown.top < q.bottom && grown.bottom > q.top)) continue
    placed.push(box)
    kept.add(it.id)
  }
  return kept
}

// tint: a hue mixed towards white as the strength `s` (0..1) falls, up to 55%
// for the weakest ray, so it stays the repeater's colour.
export function tint(hex, s) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  const f = 0.55 * (1 - Math.min(1, Math.max(0, s)))
  const ch = (v) => Math.round(v + (255 - v) * f)
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// windowText: the time window as dates, the year once when both ends share it.
export function windowText(fromIso, toIso) {
  const a = new Date(fromIso), b = new Date(toIso)
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return a.getFullYear() === b.getFullYear()
    ? `${day(a)} to ${day(b)} ${b.getFullYear()}`
    : `${day(a)} ${a.getFullYear()} to ${day(b)} ${b.getFullYear()}`
}

// huntersText: up to three hunters by name, more as a count.
export function huntersText(names) {
  const list = [...new Set((names || []).filter(Boolean))]
  if (!list.length) return ''
  if (list.length > 3) return `${list.length} hunters`
  return `${list.length} ${list.length === 1 ? 'hunter' : 'hunters'}: ${list.join(', ')}`
}

// exportFileName: the export's kind, a subject when it has one (the repeater
// of #720, in letters, digits and hyphens only), and the day.
export function exportFileName(nowMs, kind = 'repeaters-heard', subject = '') {
  const d = new Date(nowMs)
  const pad = (v) => String(v).padStart(2, '0')
  const slug = String(subject).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `mesh-hunter-${kind}${slug ? `-${slug}` : ''}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.png`
}

// reliefNote: the words beside the scale bar when the relief is shaded
// steeper than it is, at the exaggeration from Settings. None at 1×, where
// it is true to scale.
export function reliefNote(exaggeration) {
  return exaggeration > 1 ? `relief ${exaggeration}× exaggerated` : ''
}

// scaleBar: the longest round length that fits in `maxPx`, at `metresPerPx`.
const NICE_M = [100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000]
export function scaleBar(metresPerPx, maxPx = 120) {
  const m = NICE_M.filter((v) => v / metresPerPx <= maxPx).pop() || NICE_M[0]
  return { px: Math.round(m / metresPerPx), label: m >= 1000 ? `${m / 1000} km` : `${m} m` }
}
