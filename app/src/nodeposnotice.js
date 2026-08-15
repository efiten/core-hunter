// What the node-position layer must have on screen, per AGENTS.md §7.
//
// Two surfaces, deliberately different lifetimes:
//
//   note — the full disclaimer prose. A glance: it appears on every activation
//          and fades after NODEPOS_GLANCE_MS, because a permanent wall of text
//          over the HUD is what #306 was raised about.
//   key  — one line naming what the two glyphs mean. Visible for exactly as
//          long as the layer is, with no timer.
//
// The key is the part §7 actually requires. The ▲ markers are operator
// self-reported GPS, which is the one exception to "we infer position from
// radio measurements and do not GPS-track the target" — and an unlabelled
// exception is worse than no label, because ▲ and ● are visually just two
// kinds of dot. Fading the prose is a UX call; fading the key would remove
// the guarantee, so it lives here as a tested function rather than a comment
// that the next refactor can delete. (It was a comment. It got deleted.)
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

export function nodePosNotice({ on = false, glanceExpired = false } = {}) {
  return {
    // No memory of previous activations: turning the layer off and on again
    // is a fresh glance, which is the "(re-)appears" case.
    note: Boolean(on) && !glanceExpired,
    // Unconditional on `on`. If this ever gains a second term, the suite fails.
    key: Boolean(on),
  }
}
