# The node-position glyph key becomes a glance (#413)

**Date:** 2026-08-21
**Status:** decided, implemented
**Amends:** AGENTS.md §7 "Position disclaimer in all position-bearing output"
**Supersedes the permanence half of:** #306

## What changed

`#nodepos-key` — the one-liner reading `▲ advertised position (operator-reported) · ● estimate
inferred from RSSI` — used to stay on screen for exactly as long as the node-position layer was
drawn. It now fades with the prose note, on the same `NODEPOS_GLANCE_MS` timer, and reappears on
each activation of the layer.

One case does not fade: while the key is reporting an empty registry, it stays up.

## Why

The permanence was deliberate and was not wrong when it was written. Three decisions collided:

1. **#197 / #307** put a node-position layer on the map, with ▲ markers that are operator
   self-reported GPS — the one exception to "we infer position from radio and do not GPS-track the
   target". An unlabelled exception is worse than no label, because ▲ and ● are visually just two
   kinds of dot. Hence a key, and hence §7.
2. **#306** found both notices sitting over the hero RSSI readout in `#hud` and moved them into
   `#toast-stack`, which is pinned to the **top** of the screen.
3. **#322** made the receptions ticker large enough to read at a glance while driving. It occupies
   that same top band.

So from #322 onward, anyone with the node layer on had the key covering the ticker's header row and
top rows for the whole session — cancelling out precisely what #322 was for. Field screenshots in
#413 show the ticker text reading through the translucent surface behind the legend.

Both anchors were already taken by earlier decisions: the bottom by `#hud` (#306's reason for
moving it), the top by the ticker (#322). There is no third place for a permanent line, so the
question became how long it has to be there rather than where.

## Why this still satisfies §7

§7 requires that output implying a target's location says what it is. It did not, and does not,
require permanence — that was an implementation choice recorded in `nodeposnotice.js` and its
tests, not in §7's text.

The meaning stays reachable after the glance: every node-position marker popup carries the
disclaimer in `.np-caveat`. A reader who wonders what a ▲ means taps it and is told. §7 has been
amended to say this explicitly, so the requirement is now written where it is enforced.

## Why the empty-registry line is exempt

`NODEPOS_EMPTY_TEXT` is not a legend. When it shows, there are no glyphs on screen to explain; it
is the reason the map is blank. Fading it puts #307's bug back — "the resolver returned nothing"
and "there are no nodes here" become indistinguishable to anyone who looks a few seconds later. It
therefore stays up for as long as the layer is on.

This is the one part of #413 not asked for in the issue; it was added because implementing the
issue as written would have regressed #307.

## Alternatives considered

- **Move the key above `#hud`.** Keeps the guarantee intact, needs no rule change. Rejected: the
  line is long, the FAB column occupies the right edge from `bottom + 112px` upward, and #306's
  reason for leaving the bottom was that this area is where a driver reads the hero RSSI.
- **Shorten the key** so it no longer covers the ticker header. Rejected: shorter means vaguer, and
  the ▲ is exactly the claim that must not be vague.
- **Leave it permanent.** Rejected: it makes the node layer and a readable ticker mutually
  exclusive, and both shipped deliberately.

## Consequences

- `nodePosNotice` gains a `registryEmpty` term. Its tests assert the new rule rather than having
  the old assertion deleted; the test that used to be named "never lets the key depend on the
  glance timer" is gone on purpose, and this document is why.
- `web/nodeposnotice.js` (added by #426) must follow, including the parity assertion that currently
  pins the key as never fading.
