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

// How much of the ticker is on screen, as one field (#424): full, three lanes,
// one lane, or away. The same four states the app stores under
// core-hunter-ticker, for the same reason -- a size plus a separate visible
// flag would let a link land on "away and expanded", which is not a state.
export const COLLAPSE_LEVELS = 3   // full, then two shrink stops
export const HIDDEN = 'hidden'

// Would the card at its full height take more than half the map that is left
// under the bar? That, not the width, is what "it covers the map" means.
//
// `narrow` is the other half of the same question and stays a width test,
// because below 640px the card is full-bleed (`min(680px, 100vw)`) and covers
// the map from edge to edge whatever its height.
//
// The width alone was the whole rule until a phone was held sideways: 844x390
// is wider than every phone breakpoint, so the card opened at ten lanes over
// 309px of map. Measured there, it covered 110% of it -- taller than the map,
// hanging past the bottom edge.
export function coversTheMap(cardHeight, { vh, top = 0 }) {
  return cardHeight > Math.max(0, vh - top) / 2
}

// initialPlacement decides both halves on load.
//
// `saved` is what persisted from the last visit; a first visit has none. The
// default is per-surface rather than remembered-or-guessed: full where there is
// room, shrunk to the header where the card would take the map. A remembered
// choice always wins -- someone who shrank it on a desktop meant it.
//
// `size` here is the card at ten lanes, which on load is NOT what the element
// measures: #rx-log is an empty div until the ticker writes into it, so its own
// box is two pixels of border. Both answers depend on the real size -- the
// clamp strands a bottom-anchored card off screen, the default opens a card
// that covers the map -- so the caller computes it from the geometry tokens
// instead of measuring it.
export function initialPlacement({ saved = null, size, viewport, narrow = false }) {
  const at = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: saved.x, y: saved.y }
    : topRight(size, viewport)
  // A remembered choice always wins. Without one, a phone starts at the
  // smallest stop rather than away: the reason the default is per-surface is
  // that the card should not cover the map there, and a ticker nobody can see
  // is a different thing from a small one.
  const remembered = saved && (saved.hidden === true || Number.isInteger(saved.collapse))
  const cramped = narrow || coversTheMap(size.h, viewport)
  return {
    ...clampToViewport(at, size, viewport),
    hidden: remembered ? !!saved.hidden : false,
    collapse: remembered ? (saved.collapse || 0) : (cramped ? COLLAPSE_LEVELS - 1 : 0),
  }
}

// serialise/parse keep the persisted value one short string, since it rides in
// the same URL/localStorage state as every other view setting. Rounded: a
// sub-pixel drag offset is noise in a shared link.
// The states are written as letters, not as their numbers. A link from before
// #424 carries 0 or 1 for expanded or folded, and 1 has to keep meaning "put
// away", so a new state cannot also be written as "1" without the two
// colliding on read. Letters keep the old and the new readable in one field.
const STATE_CHARS = ['0', 'a', 'b']   // full, three lanes, one lane
const HIDDEN_CHAR = 'h'

export function serialise({ x, y, collapse, hidden }) {
  const state = hidden ? HIDDEN_CHAR : STATE_CHARS[clampLevel(collapse)]
  return `${Math.round(x)},${Math.round(y)},${state}`
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
  // '1' is the pre-#424 "folded", which was how the ticker was put away before
  // it had a cross, so it reads as away. Anything unrecognised reads as full,
  // which is where a truncated or hand-edited link should land.
  if (c === HIDDEN_CHAR || c === '1') return { x: nx, y: ny, collapse: 0, hidden: true }
  const i = STATE_CHARS.indexOf(c)
  return { x: nx, y: ny, collapse: i === -1 ? 0 : i, hidden: false }
}
