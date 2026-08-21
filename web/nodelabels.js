// Where the node-position layer's name labels may be drawn (#425).
//
// Its own module rather than more of nodelayer.js, because it answers a
// different question. nodelayer.js works in geography — which registry rows can
// be plotted, which receptions may attribute to them, how far the estimate sits
// from the advertised point. This works in screen space, where the only inputs
// are pixels and the answer changes with the zoom without a single node
// changing. The app's layer has the same overlap problem and can take this file
// verbatim when it wants it; keeping it separate is what makes that a copy
// rather than a merge.
//
// Every advertised node was drawn as a divIcon with its name baked in, at full
// length, whatever the zoom and whatever else was nearby. Leaflet was told the
// marker is 14x16 — that describes the ▲, not the label — so it had no idea how
// wide these things really are, and at any real cluster density the names
// printed over each other into an unreadable smear.
//
// The rule is greedy and order-driven: walk the list once, keep a label if its
// box is clear of the ones already kept, otherwise drop it. The ▲ always stays,
// and the name is still in the popup, so nothing becomes unreachable.
//
// Ordering is the caller's job and matters: it decides which of two colliding
// names survives. map.js sorts by node id rather than by anything positional,
// so panning the map does not reshuffle the winners and make labels flicker in
// and out of existence around the edges.

// An 11px system-stack label. Character width is an average glyph advance, not
// a measurement: measuring every label per redraw costs a layout pass each, and
// the estimate only has to be good enough to decide overlap. It errs slightly
// wide, which drops a borderline label rather than printing two over each other.
export const LABEL_CHAR_PX = 6.2
export const LABEL_HEIGHT_PX = 13
// ▲ glyph box (14) + the label's own margin-left (4), matching .np-label.
export const LABEL_OFFSET_PX = 18

// labelBox is where a label lands in screen space, given its marker's projected
// point. Mirrors .np-label: to the right of the ▲, vertically centred on it.
export function labelBox({ x = 0, y = 0, label = '' } = {}, { charPx = LABEL_CHAR_PX, heightPx = LABEL_HEIGHT_PX, offsetPx = LABEL_OFFSET_PX } = {}) {
  return {
    left: x + offsetPx,
    top: y - heightPx / 2,
    width: String(label || '').length * charPx,
    height: heightPx,
  }
}

function boxesOverlap(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height
}

// unclutteredLabels returns the ids that keep their label, in the order given.
// A dropped label is NOT added to the blocker set: it is not on screen, so it
// cannot hide anything, and treating it as a blocker would let one dense
// cluster go on suppressing names well outside it.
export function unclutteredLabels(items, opts) {
  if (!Array.isArray(items)) return []
  const placed = []
  const kept = []
  for (const item of items) {
    const box = labelBox(item, opts)
    // Nothing is drawn for an empty name, so it neither takes a slot nor
    // blocks one.
    if (!box.width) continue
    if (placed.some((p) => boxesOverlap(box, p))) continue
    placed.push(box)
    kept.push(item.id)
  }
  return kept
}
