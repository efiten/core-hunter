# What you hear now stands apart from what you heard before (#556)

**Date:** 2026-09-04
**Status:** decided (Kasper, 2026-09-04, against a rendered design), implemented; amended 2026-09-14 for #648
**Related:** #149 (age fade, removed since by #648), #549 (reach per hex cell, shares the label spot), #558 (why a prefix never comes from a hashed or refused identity), #647 (new versus old in 3D, the question this left open)

## What changed

The map drew a live reception and the stored backlog the same way. Open the app mid-hunt and the screen filled with everything in the time window; what landed right now, the thing you steer on, was indistinguishable from what already stood there. Age fade encodes age, not arrival: a 20-minute-old point looked the same whether it was on screen all along or loaded a second ago.

Four rules now. All four were decided for 2D and the 3D views kept their drawing, until #648 gave the pulse a form of its own there (rule 4):

1. **"Old" is everything from before the current ride** (`app/src/rides.js`). A ride ends when there is a gap of more than 10 minutes between consecutive receptions. Everything before the last such gap is backlog, whatever the time window says; a hunt that keeps going across an app restart stays one ride.
2. **Zoomed out, the backlog is coverage only.** Below zoom 15 a backlog reception has no point, only its hex cell. What lands now is a point on top of that coverage.
3. **From zoom 15, the backlog comes back as outlines.** A backlog reception is an outline circle in its tier colour, no fill, a heavier stroke; a reception from this ride is drawn filled, as before. Colour and place stay, so the backlog is still a measurement; the fill says "this ride". Age fade used to ride on top of both; #648 removed it, so the fill is now the whole distinction.
4. **The newest reception pulses.** One ring in its tier colour, 1.6 s, on the reception that just arrived, whatever the zoom, and only when the filter would draw it. The ring follows the flat point layer (`layerVisibility`, Kasper, 2026-09-11): no ring in hex mode, where no point is drawn for the reception. In 3D the ring would lie on the ground underneath the reception's pillar, so #648 gave the pulse a second form there rather than dropping it: the pillar itself flashes, white and solid when the reception lands and settling onto the pillar's own colour over the same 1.6 s. One form per dimension, never both at once.

And a hex cell carries a label from zoom 16 (`app/src/hexlabels.js`): the 4-character prefixes of the nodes heard in it, newest first, three at most, then `+N`. A prefix comes only from a record with a node id; the hash kinds (`direct_hash`, `path_hash`) never contribute one, and a refused identity has none. Drawn as HTML markers like the node layer, since the bare fallback style has no glyphs for a symbol layer.

## In 3D (#647)

The four rules above were written for 2D. #648 gave the pulse a form that works in 3D; #647 answers the other half, old versus new:

5. **A pillar from before this ride is dimmed to one flat value.** Everything from this ride keeps its tier's own opacity (0.7 down to 0.19 across the tiers that draw a pillar at all); everything from before takes 0.12, off the tier scale entirely, so within one colour this ride is always the more present of the two. A factor per tier was rejected: tier x 0.5 would put a backlog hot pillar (0.35) exactly where a this-ride cool one sits (0.34), and the ride is a yes or no, not a degree.
6. **Where old and new share a spot, the new one is the pillar.** Coincident receptions collapse onto a single pillar (#402), decided by signal alone until now, so a louder reception from an earlier ride could stand in for one that just arrived and read as "not heard here today" on a place just heard. The ride now ranks above the strength; the strength still decides within a ride.

Both are app-only. The web map draws published points from every hunter, where there is no current ride for anything to be before.

Underneath them, a rendering correction that applies to both maps: a pillar's tier opacity is now pre-mixed over the theme background and drawn opaque, the way the hex bars already were (#412), instead of riding in the colour's alpha. MapLibre composites a translucent fill-extrusion against black rather than against what lies under it, measured 2026-09-14 against MapLibre 4.7.1 with an opaque light layer directly beneath one. On the dark theme that is invisible, since the ground is nearly black anyway, which is why it stood this long; on the light theme it inverted the meaning, a weaker tier reading as more ink on a cream map. Without this correction the dimming in rule 5 would have made a backlog pillar stand out harder than a fresh one, the exact opposite of the intent.

## Why these and not the alternatives

Four drawings of one drive were put side by side (design round R10): today's rendering, "new pulses and old is outline", "old as hex only and new as points", and the two label forms. Kasper took the coverage drawing for the zoomed-out view and the outlines once zoomed in, "reasonably soon" (zoom 15), with the pulse in both. The ride rather than the app-open moment, because a restart mid-hunt must not turn the hunt into backlog. Prefixes rather than a count, with the #558 caveat kept: a prefix is an id, never a name, and never from an identity the app refused.

## Left out

- Rendering in 3D: a label on a pillar's top would float at ground level under it, the pulse's ring would sit on the ground under the pillar, and outline pillars have no meaning. The pulse has since left this list: #648 gave it a 3D form of its own (rule 4), on the pillar rather than on the ground. What "old" looks like in 3D is still open, and is #647.
- A count per cell, and anything about a cell's reach: #549.
