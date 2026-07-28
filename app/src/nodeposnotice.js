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

export function nodePosNotice({ on = false, glanceExpired = false } = {}) {
  return {
    // No memory of previous activations: turning the layer off and on again
    // is a fresh glance, which is the "(re-)appears" case.
    note: Boolean(on) && !glanceExpired,
    // Unconditional on `on`. If this ever gains a second term, the suite fails.
    key: Boolean(on),
  }
}
