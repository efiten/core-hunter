// What the node-position layer must have on screen, per AGENTS.md §7.
//
// Two surfaces, deliberately different lifetimes:
//
//   note — the full disclaimer prose. A glance: it appears on every activation
//          and fades after NODEPOS_GLANCE_MS, because a permanent wall of text
//          over the HUD is what #306 was raised about.
//   key  — one line, and since #631 it is no longer a legend. It says which way
//          the layer came up empty, and nothing else. It does not fade, because
//          it explains an absence rather than labelling something present.
//
// The glyph key used to live on that second surface, and the road it travelled
// is worth carrying rather than being rediscovered as a bug. The ▲ markers are
// operator self-reported GPS, the one exception to "we infer position from
// radio measurements and do not GPS-track the target", and an unlabelled
// exception is worse than no label, because ▲ and ● are visually just two
// kinds of dot. So #197/#307 gave it a permanent key, and §7 required one.
//
// #306 then pushed both notices out of the HUD into #toast-stack, pinned to
// the top of the screen; #322 made the receptions ticker large enough to read
// while driving, and it takes that same band. A permanent key therefore sat on
// the ticker for the whole session and cancelled out exactly what #322
// delivered, so #413 made it a glance on each activation.
//
// #631 asks the question one level up. A reader who wants to know what a
// marker is taps it, and the popup has carried that answer since #197
// (.np-caveat). A second copy written over the map is not what the rule needs,
// it is what the rule cost. So the key is gone from both surfaces, the popup
// carries the whole meaning — both glyphs, not just the advertised one — and
// §7 has been revised to say where that meaning lives rather than that it must
// also be painted over the map. See docs/2026-08-21-nodepos-key-glance.md for
// the round before this one.
export const NODEPOS_GLANCE_MS = 2000

// The two sentences the marker popup carries, one per glyph (#631). They live
// here rather than in each map module because they are the whole of what §7
// now requires on screen, and because both surfaces have to say it the same
// way — web/parity.test.js pins them together.
//
// Advertised: the operator typed it, and nothing refreshes it.
export const NODEPOS_ADVERT_CAVEAT = 'Advertised position is self-reported by the operator and may be stale.'

// Estimate: this is the half the old key carried and the popup never did. "Not
// GPS" is the claim §7 exists to prevent, and a ● beside a ▲ is exactly where
// a reader would assume otherwise.
export const NODEPOS_ESTIMATE_CAVEAT = 'The estimate is inferred from RSSI, not from GPS tracking of the node.'

// Shown when no configured resolver returned any position at all (#307).
// Toggling the layer on used to look identical whether it had worked with
// nothing to show or failed silently. Names the registry, because that is the
// half that is missing; "no nodes in view right now" is a different sentence.
export const NODEPOS_EMPTY_TEXT = 'No positions from the node registry — resolver unreachable or it holds none, so nothing can be drawn'

// What the second surface says. Since #631 that is either an explanation for an
// empty map or nothing at all: with markers on screen the popup answers what a
// glyph is, and a line repeating it over the map is what #631 removed.
export function nodePosKeyText({ registryEmpty = false } = {}) {
  return registryEmpty ? NODEPOS_EMPTY_TEXT : ''
}

export function nodePosNotice({ on = false, glanceExpired = false, registryEmpty = false } = {}) {
  return {
    // No memory of previous activations: turning the layer off and on again
    // is a fresh glance, which is the "(re-)appears" case.
    note: Boolean(on) && !glanceExpired,
    // Only the empty-registry explanation is left, and it never fades: it is
    // the reason the map is blank, not a label for glyphs on it. Fading it
    // restores #307's bug, where "the resolver gave us nothing" and "nothing
    // is here" look identical.
    key: Boolean(on) && Boolean(registryEmpty),
  }
}
