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
// Widths are measured, not estimated. A first pass used an average glyph
// advance to avoid a layout pass per label per redraw; the saving was real but
// the average was not safe, since it ran narrow on uppercase names and narrow
// is the direction that permits an overlap. Measuring once per distinct name
// and caching costs the same order of work — a viewport holds tens of names,
// not thousands — and is exact. See createLabelMeasurer.
//
// Ordering is the caller's job and matters: it decides which of two colliding
// names survives. map.js sorts by node id rather than by anything positional,
// so panning the map does not reshuffle the winners and make labels flicker in
// and out of existence around the edges.

// Fallback glyph advance, for a caller with no DOM to measure in (the unit
// tests). It is an average and cannot be safe for every name: measured against
// the real .np-label, `NL-DR-GTN-OBS01` is 100.1 px against 93.0 estimated and
// `ON8AR` is 37.1 against 31.0, while `nl-dr-gtn-rp02` is 69.3 against 86.8.
// Uppercase names run narrow, which is the dangerous direction — an
// under-estimate permits the overlap this module exists to prevent — and
// MeshCore repeater names are overwhelmingly uppercase. So a real caller passes
// `measure` (see createLabelMeasurer) and this is never consulted.
export const LABEL_CHAR_PX = 6.2
export const LABEL_HEIGHT_PX = 13
// ▲ glyph box (14) + the label's own margin-left (4), matching .np-label.
export const LABEL_OFFSET_PX = 18

// createLabelMeasurer returns measure(text) -> px, backed by one hidden probe
// span and a cache keyed by the text.
//
// A label's width does not depend on the zoom — only its position does — so
// this is one forced layout per DISTINCT name, not one per label per redraw. A
// viewport holds tens of distinct names and they repeat across every pan and
// zoom, so after the first draw it is a Map lookup.
//
// `host` matters, and it is not document.body. Neither .np-label nor the probe
// sets a font-family, so both inherit, and the labels live inside the Leaflet
// container — which Leaflet's own stylesheet gives `"Helvetica Neue", Arial,
// Helvetica, sans-serif`, not the page's system-ui. Measured side by side, a
// probe on document.body reads 103.2 px for `NL-DR-GTN-OBS01` where the drawn
// label is 100.1, and 77.9 for `nl-dr-gtn-rp02` where it is 69.3 — wrong in
// both directions. Hosted in the map container, all seven names measured
// matched the drawn label exactly. So the probe goes where the labels go.
//
// The probe does NOT wear .np-label: everything that decides its width is
// shared with .np-label in the stylesheet, but a probe answering a
// `.np-label` query would be counted as a name on screen.
export function createLabelMeasurer(host) {
  const doc = host && host.ownerDocument
  if (!doc) return null
  const probe = doc.createElement('span')
  probe.className = 'np-label-probe'
  host.appendChild(probe)
  const cache = new Map()
  const measure = (text) => {
    const t = String(text || '')
    // Nothing is drawn for an empty name; short-circuit so it never costs a
    // layout and never lands in the cache.
    if (!t) return 0
    if (!cache.has(t)) {
      probe.textContent = t
      cache.set(t, probe.getBoundingClientRect().width)
    }
    return cache.get(t)
  }
  return measure
}

// labelBox is where a label lands in screen space, given its marker's projected
// point. Mirrors .np-label: to the right of the ▲, vertically centred on it.
export function labelBox({ x = 0, y = 0, label = '' } = {}, { measure = null, charPx = LABEL_CHAR_PX, heightPx = LABEL_HEIGHT_PX, offsetPx = LABEL_OFFSET_PX } = {}) {
  const text = String(label || '')
  return {
    left: x + offsetPx,
    top: y - heightPx / 2,
    width: measure ? measure(text) : text.length * charPx,
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
