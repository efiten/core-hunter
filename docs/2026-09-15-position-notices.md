# Explanation stays, the mandatory position notices go (#662)

**Date:** 2026-09-15
**Status:** decided (Kasper, 2026-09-14, on #662), implemented
**Related:** #631 and #653 (the glyph meaning moved into the marker popup), #413 and #426 (the note became a glance), #307 and #376 (the lines that say why nothing is drawn), #660 (the arrow, the next position-bearing output), `docs/2026-08-21-nodepos-key-glance.md`

## What changed

AGENTS.md §7 used to require every output that implies a location to carry a position disclaimer. Each new position-bearing output added one more copy of the same statement, and the arrow (#660) would have been the next.

Removed, on the app and on the map:

1. **The rule itself**: the §7 section "Position disclaimer in all position-bearing output". The §1 paragraph that explains what a position is stays, under the label "Position is inferred".
2. **The node-positions note** (`#nodepos-note`): the prose over the map on each activation of the layer, and on both surfaces the glance machinery that only existed for it (`NODEPOS_GLANCE_MS`, the fade timers, the map's narrow-screen re-render).
3. **The popup caveats** (`NODEPOS_ADVERT_CAVEAT`, `NODEPOS_ESTIMATE_CAVEAT`, `.np-caveat`): the two sentences under every node popup.
4. **The Locate disclaimer** (`LOCATE_DISCLAIMER`, `.lc-disclaimer`) at the bottom of the map's Locate box.

## What stays

- **The statement where it explains the product**: the app's splash (`SPLASH_DISCLAIMER_SHORT`), the About sheet on both surfaces and the map's onboarding (`ONBOARDING_DISCLAIMER`). They say once what the app does, rather than repeating it beside every output.
- **The popup's glyph line**, `▲ advertised · ● estimated`. It names what each glyph on that node is, which #631 moved into the popup.
- **Every line that says why nothing is drawn**: an empty registry, an unreachable or unconfigured registry, a role below member, no registry nodes in view, a registry that could not be refreshed. Those report a state; they do not disclaim a position.
- **Locate's own honesty line**, `Within driven area · ~hundreds of m · no TX calibration`, and the one-sided and 1-byte warnings. They describe the estimate's numbers, not what a position is.

## The explanation rule moved

The last paragraph of the removed §7 section was the only written rule that a line explaining an absence stays up for as long as the state lasts (#307): fading it makes "we got nothing" and "there is nothing here" look alike. That rule has nothing to do with disclaimers, so it moved to `docs/design-system.md`, "Notices and readouts are not controls", instead of going with the section.

## History

The note started as a permanent key (#197, #307), moved into `#toast-stack` (#306), collided with the enlarged ticker (#322) and became a glance (#413, and on the map's phone width #426). #631 took the glyph key off the map and put its meaning in the popup. This decision removes what was left of the repetition. `docs/2026-08-21-nodepos-key-glance.md` records the glance round.
