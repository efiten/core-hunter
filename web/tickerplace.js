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

// initialPlacement decides both halves on load.
//
// `saved` is what persisted from the last visit; a first visit has none. The
// collapsed default is per-surface rather than remembered-or-guessed: expanded
// on a desktop, collapsed on a phone, where the band is what covers the map.
// A remembered choice always wins -- someone who collapsed it on a desktop
// meant it.
export function initialPlacement({ saved = null, size, viewport, narrow = false }) {
  const at = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: saved.x, y: saved.y }
    : topRight(size, viewport)
  const collapsed = saved && typeof saved.collapsed === 'boolean' ? saved.collapsed : narrow
  return { ...clampToViewport(at, size, viewport), collapsed }
}

// serialise/parse keep the persisted value one short string, since it rides in
// the same URL/localStorage state as every other view setting. Rounded: a
// sub-pixel drag offset is noise in a shared link.
export function serialise({ x, y, collapsed }) {
  return `${Math.round(x)},${Math.round(y)},${collapsed ? 1 : 0}`
}

export function parse(v) {
  if (typeof v !== 'string' || !v) return null
  const [x, y, c] = v.split(',')
  const nx = Number(x), ny = Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  return { x: nx, y: ny, collapsed: c === '1' }
}
