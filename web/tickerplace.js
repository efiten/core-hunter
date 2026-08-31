// Where the receptions ticker sits, and whether it is showing (#424).
//
// Since #322 the ticker is a full-width centred band under the bar: ~200px of
// text lying across the middle-top of the map, colliding with Leaflet's zoom
// control at the top-left, and on a phone landing on the node-position labels.
// There was no way to put it away.
//
// Decided on the issue (2026-08-21): dragging REPLACES the anchor rather than
// overriding it. The ticker starts top-right on a first visit and afterwards
// sits wherever it was left. That makes "put it back" not free, so the clamp
// below is the safety net rather than a nicety -- a ticker dragged to the edge
// of a wide screen has to still be reachable on a narrow one.
//
// Pure so the geometry can be tested without a browser: the caller measures.

// Gap from the map's edges when the ticker has never been placed by hand.
export const EDGE_GAP = 12

// clampToViewport keeps the box on screen. `top` is the bar's lower edge: the
// ticker hangs below the bar, never under it, because the bar is opaque and
// would simply hide the rows.
//
// Clamping the far edge before the near one matters when the box is LARGER than
// the space (a narrow phone, an expanded ticker): the near edge wins, so the
// box stays reachable from its top-left rather than being pushed off the other
// way and stranded.
export function clampToViewport({ x, y }, { w, h }, { vw, vh, top = 0 }) {
  const maxX = Math.max(0, vw - w)
  const maxY = Math.max(top, vh - h)
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(top, y), maxY),
  }
}

// topRight is the first-visit position: out of the centre where the map content
// is, and clear of the zoom control at the top-left, which is the collision the
// issue names.
export function topRight({ w }, { vw, top = 0 }) {
  return { x: Math.max(0, vw - w - EDGE_GAP), y: top + EDGE_GAP }
}

// How far the ticker is shrunk, as a level rather than a boolean (#424). The
// chevron walks four stops now: full, three lanes, one, then the header alone.
// The old value was 0 or 1 for expanded or folded, and the folded end is the
// last level, so an old link still lands where it meant to.
export const COLLAPSE_LEVELS = 4
const LEGACY_FOLDED = COLLAPSE_LEVELS - 1

// initialPlacement decides both halves on load.
//
// `saved` is what persisted from the last visit; a first visit has none. The
// default is per-surface rather than remembered-or-guessed: full on a desktop,
// shrunk to the header on a phone, where the band is what covers the map. A
// remembered choice always wins -- someone who shrank it on a desktop meant it.
export function initialPlacement({ saved = null, size, viewport, narrow = false }) {
  const at = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: saved.x, y: saved.y }
    : topRight(size, viewport)
  const collapse = saved && Number.isInteger(saved.collapse)
    ? saved.collapse
    : (narrow ? LEGACY_FOLDED : 0)
  return { ...clampToViewport(at, size, viewport), collapse }
}

// serialise/parse keep the persisted value one short string, since it rides in
// the same URL/localStorage state as every other view setting. Rounded: a
// sub-pixel drag offset is noise in a shared link.
// The stops above full are written as letters, not as their numbers. A link
// from before #424 carries 0 or 1 for expanded or folded, and 1 has to keep
// meaning the header alone, so a new level 1 cannot also be written as "1"
// without the two colliding on read. Letters keep both readable in one field.
const LEVEL_CHARS = ['0', 'a', 'b', 'c']

export function serialise({ x, y, collapse }) {
  return `${Math.round(x)},${Math.round(y)},${LEVEL_CHARS[clampLevel(collapse)]}`
}

function clampLevel(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) return 0
  return Math.min(n, COLLAPSE_LEVELS - 1)
}

export function parse(v) {
  if (typeof v !== 'string' || !v) return null
  const [x, y, c] = v.split(',')
  const nx = Number(x), ny = Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  return { x: nx, y: ny, collapse: parseLevel(c) }
}

// '1' is the pre-#424 "folded", which meant the header alone and is now the
// last level. Anything unrecognised reads as full, which is what a link with a
// truncated or hand-edited field should land on.
function parseLevel(c) {
  if (c === '1') return LEGACY_FOLDED
  const i = LEVEL_CHARS.indexOf(c)
  return i === -1 ? 0 : i
}
