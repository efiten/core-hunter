# The coverage overview: every repeater's reach at once, each in its own hue (#603)

**Date:** 2026-09-08
**Status:** decided (Kasper, 2026-09-07 and 08, after the design rounds in `design-canvas/` and two renders on the real data), implemented on both maps in the same PR as #549
**Related:** #549 (the star of one node, which this grew out of), #197 (the node-position layer it rides on), #595 (3D on the map), #481/#482 (the two-way hearings), #320 (the identity is unauthenticated), #374/#554 (other hunters' data, not this)

## What changed

The map answered "where did I hear something" in one palette: every cell and point took the tier colour of its best RSSI, whoever was heard there. With five repeaters along one road that was one red band, and the question at the end of a drive, which repeater covers what and where one hands over to the next, had no view.

Node positions now has a third stop, **Positions + reach**: every repeater in view draws its star at once, one ray from its position to each reception attributed to it, in a hue fixed per id. The app's FAB cycles off / positions / positions + reach with the ring showing the stop; the map's filter panel has the same three as a segmented control. The star of one node (#549, `docs/2026-09-06-reach-of-a-node.md`) is this drawing for one repeater, and its popup buttons are gone: the layer draws all of them.

## The decisions

1. **Rays, not cells or clouds** (2026-09-06, kept from #549). They show the density per direction and the gaps where nobody drove, which one shape hides.
2. **A hue per repeater id, fixed** (`coverage.js` `hueSlot`, `assignHues`). Twelve `--ch-hue-*` tokens in both sheets, the slot a hash of the id, so a repeater keeps its colour across sessions and between the app and the map. Two repeaters within 2 km may not share a slot: the later id in id order walks to the next free one. A raw hash over more colours gives near-twins next to each other.
3. **Strength in the ray** (`rayStyle`). Width and opacity run over about -120 to -60 dBm; not the six tier bands, since a ray wants a continuous ramp. The dots of the hearings take the repeater's hue while the reach is on; the pillars in 3D keep the tier.
4. **Two-way by opacity** (2026-09-08). A Discover or trace reply to our own ask (`sender_kind` discover_pubkey or trace_reply) proves the link works both ways from that spot. Those rays draw at full opacity; a one-way hearing draws the same ray at 40%. Kasper chose this over a dash and over a marker at the hunter's end, after a render of both on the real data: the dash competed with the strength scale, the marker hid the dots.
5. **No cap** (2026-09-08). Every repeater with hearings in the view draws; the zoom decides what is legible. A render of the real data (Nijmegen to Arnhem, all time) drew 41 repeaters with 10 or more hearings; a top-N dropped Arnhem.
6. **One selected** (2026-09-08). A tap on a repeater's ▲ or ● selects its star, and so does picking it as a target; both drive one selection. The selected star draws as it is, its name in a pill on the marker; every other star drops to 25% in its own hue, so the hand-over to the neighbours stays readable. A second tap, or a tap on bare map, clears it. With a target picked the plotted set is narrowed to it, so the stars come from the same window without the sender filter.
7. **3D from the mast** (2026-09-08). Each ray starts 30 m above the ground at the repeater and lands at ground level at the hearing. A MapLibre line layer lies on the ground, so this is a custom WebGL layer (`raylayer.js`): each ray a screen-space quad between two mercator points with altitude, the terrain's height under both ends when the mesh is on. No deck.gl: it would have been the first dependency either map carries for one layer, and the layer is 150 lines.
8. **Attribution** is `classifyReception`'s rule: the originator at zero hops, or the last relay of a flood. On a record: `sender_role` Repeater, or `sender_kind` relay, discover_pubkey or trace_reply. A relay hash has no registry position, so that star hangs from the RSSI estimate (●); a full pubkey the registry places hangs from its ▲.

## What it claims, and what it does not

A star is a lower bound built from where hunters drove: unmeasured is not unreachable. It rests on an unauthenticated identity (#320): a forged sender id inflates that repeater's star, the same caveat Locate carries. Both are in the hub's title.

## Left out

- Coverage from other hunters' data or from observer feeds: #374, #554.
- Where a node without a position might be: #549 phase 2, a spike.
- The `coverage.js` and `raylayer.js` copies are pinned byte for byte by `web/parity.test.js`, as the #595 files are.
