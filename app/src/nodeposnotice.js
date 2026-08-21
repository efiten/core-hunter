// What the node-position layer must have on screen, per AGENTS.md §7.
//
// Two surfaces, deliberately different lifetimes:
//
//   note — the full disclaimer prose. A glance: it appears on every activation
//          and fades after NODEPOS_GLANCE_MS, because a permanent wall of text
//          over the HUD is what #306 was raised about.
//   key  — one line naming what the two glyphs mean. Shown on activation and
//          faded with the prose since #413 — with one exception, below.
//
// The key used to have no timer, and that was deliberate: the ▲ markers are
// operator self-reported GPS, the one exception to "we infer position from
// radio measurements and do not GPS-track the target", and an unlabelled
// exception is worse than no label, because ▲ and ● are visually just two
// kinds of dot.
//
// #413 changed it, and the reasoning is worth carrying rather than being
// rediscovered as a bug. #306 pushed both notices out of the HUD into
// #toast-stack, which is pinned to the top of the screen. #322 then made the
// receptions ticker large enough to read at a glance while driving, and it
// occupies that same band. A permanent key therefore sat on the ticker for the
// whole session and cancelled out exactly what #322 delivered. §7 now asks that
// the meaning be shown on activation and stay reachable, and it is: every
// marker popup carries the disclaimer in .np-caveat. See
// docs/2026-08-21-nodepos-key-glance.md.
//
// The exception is registryEmpty. That line is not a legend — there are no
// glyphs on screen to explain — it is the reason the map is blank. Fading it
// restores #307's bug, where "the resolver gave us nothing" and "nothing is
// here" look identical, so it stays up for as long as the layer is on.
export const NODEPOS_GLANCE_MS = 2000

export const NODEPOS_KEY_TEXT = '▲ advertised position (operator-reported) · ● estimate inferred from RSSI'

// Shown instead of the key when no configured resolver returned any position
// at all (#307). Toggling the layer on used to look identical whether it had
// worked with nothing to show or failed silently — and a glyph key is worse
// than useless with no glyphs on screen, since it implies the layer is fine
// and the area is simply empty. Names the registry, because that is the half
// that is missing; "no nodes in view right now" is a different sentence.
export const NODEPOS_EMPTY_TEXT = 'No positions from the node registry — resolver unreachable or it holds none, so nothing can be drawn'

// Which line the permanent surface carries. The surface itself is
// unconditional on `on` (see nodePosNotice), so the layer is never unlabelled;
// this only decides what it says.
export function nodePosKeyText({ registryEmpty = false } = {}) {
  return registryEmpty ? NODEPOS_EMPTY_TEXT : NODEPOS_KEY_TEXT
}

export function nodePosNotice({ on = false, glanceExpired = false, registryEmpty = false } = {}) {
  return {
    // No memory of previous activations: turning the layer off and on again
    // is a fresh glance, which is the "(re-)appears" case.
    note: Boolean(on) && !glanceExpired,
    // Same glance as the prose, except when the line is reporting an empty
    // registry rather than labelling glyphs — see the header.
    key: Boolean(on) && (!glanceExpired || Boolean(registryEmpty)),
  }
}
