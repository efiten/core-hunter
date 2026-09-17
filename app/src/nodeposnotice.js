// What the node-position layer writes over the map: one line, and only when
// it has to explain why nothing could be drawn.
//
// The road here is worth carrying rather than being rediscovered as a bug.
// #197/#307 gave the layer a permanent glyph key, because ▲ (operator
// self-reported) and ● (our estimate) are visually just two kinds of dot.
// #306 pushed the notices into #toast-stack at the top of the screen, #322 put
// the enlarged receptions ticker in that same band, and #413 made the key a
// glance. #631 moved the glyph meaning into the marker popup, which is where a
// reader who asks "what is this ▲" already goes, and #662 dropped the rest:
// the prose note over the map and the popup sentences that repeated that
// positions are inferred. The splash and the About sheet say that once, and
// the popup's glyph line still names each glyph it drew. See
// docs/2026-09-15-position-notices.md.
//
// What stays is not a notice but an explanation: the line saying the registry
// came back empty. It does not fade, because "the resolver gave us nothing"
// and "nothing is here" must not look alike (#307).

// Shown when no configured resolver returned any position at all (#307).
// Toggling the layer on used to look identical whether it had worked with
// nothing to show or failed silently. Names the registry, because that is the
// half that is missing; "no nodes in view right now" is a different sentence.
export const NODEPOS_EMPTY_TEXT = 'No positions from the node registry — resolver unreachable or it holds none, so nothing can be drawn'

// Whether "the registry is empty" is a fact yet. Only once a load has finished
// with nothing, and while no other load is out: #661 loads the registry again
// on connect, and a retry that may still answer is not a failure. Until then
// saying nothing is the honest answer (#307). With no resolver configured
// (`resolvers` 0) there is nothing to ask and no load ever runs, so it is a
// fact from the start.
export function registryKnownEmpty({ attempted = false, loading = false, count = 0, resolvers = null } = {}) {
  return (Boolean(attempted) || resolvers === 0) && !loading && count === 0
}

// What the line says: the explanation for an empty map, or nothing at all.
// With markers on screen the popup's glyph line names what each glyph is, and a
// line repeating it over the map is what #631 removed.
export function nodePosKeyText({ registryEmpty = false } = {}) {
  return registryEmpty ? NODEPOS_EMPTY_TEXT : ''
}

export function nodePosNotice({ on = false, registryEmpty = false } = {}) {
  return {
    // The empty-registry explanation, and nothing else. It never fades: it is
    // the reason the map is blank, not a label for glyphs on it. Fading it
    // restores #307's bug, where "the resolver gave us nothing" and "nothing
    // is here" look identical.
    key: Boolean(on) && Boolean(registryEmpty),
  }
}
