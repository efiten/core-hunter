# What you hear now stands apart from what you heard before (#556)

**Date:** 2026-09-04
**Status:** decided (Kasper, 2026-09-04, against a rendered design), implemented
**Related:** #149 (age fade, unchanged), #549 (reach per hex cell, shares the label spot), #558 (why a prefix never comes from a hashed or refused identity)

## What changed

The map drew a live reception and the stored backlog the same way. Open the app mid-hunt and the screen filled with everything in the time window; what landed right now, the thing you steer on, was indistinguishable from what already stood there. Age fade encodes age, not arrival: a 20-minute-old point looked the same whether it was on screen all along or loaded a second ago.

Four rules now, all in 2D; the 3D views keep their drawing:

1. **"Old" is everything from before the current ride** (`app/src/rides.js`). A ride ends when there is a gap of more than 10 minutes between consecutive receptions. Everything before the last such gap is backlog, whatever the time window says; a hunt that keeps going across an app restart stays one ride.
2. **Zoomed out, the backlog is coverage only.** Below zoom 15 a backlog reception has no point, only its hex cell. What lands now is a point on top of that coverage.
3. **From zoom 15, the backlog comes back as outlines.** A backlog reception is an outline circle in its tier colour, no fill, a heavier stroke; a reception from this ride is drawn filled, as before. Colour and place stay, so the backlog is still a measurement; the fill says "this ride". Age fade rides on top of both.
4. **The newest reception pulses.** One ring in its tier colour, 1.6 s, on the reception that just arrived, whatever the zoom, and only when the filter would draw it.

And a hex cell carries a label from zoom 16 (`app/src/hexlabels.js`): the 4-character prefixes of the nodes heard in it, newest first, three at most, then `+N`. A prefix comes only from a record with a node id; the hash kinds (`direct_hash`, `path_hash`) never contribute one, and a refused identity has none. Drawn as HTML markers like the node layer, since the bare fallback style has no glyphs for a symbol layer.

## Why these and not the alternatives

Four drawings of one drive were put side by side (design round R10): today's rendering, "new pulses and old is outline", "old as hex only and new as points", and the two label forms. Kasper took the coverage drawing for the zoomed-out view and the outlines once zoomed in, "reasonably soon" (zoom 15), with the pulse in both. The ride rather than the app-open moment, because a restart mid-hunt must not turn the hunt into backlog. Prefixes rather than a count, with the #558 caveat kept: a prefix is an id, never a name, and never from an identity the app refused.

## Left out

- Rendering in 3D: a label on a pillar's top would float at ground level under it, and outline pillars have no meaning.
- A count per cell, and anything about a cell's reach: #549.
