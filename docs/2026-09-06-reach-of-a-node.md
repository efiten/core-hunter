# The reach of a node is the star of its direct hearings (#549, phase 1)

**Date:** 2026-09-06
**Status:** decided (Kasper, 2026-09-06, after design rounds R13 and R14 in `design-canvas/`), implemented on the map
**Related:** #465 (the map this is drawn on), #197 (node positions and the estimate), #320 (the identity is unauthenticated), #452 (a name on a short id is a guess), #517 and phase 2 of #549 (the inverse question, a spike)

## What changed

Filtering to one repeater showed the points where you heard it and nothing about how far it reaches; two nodes could not be compared. The map now draws a node's **reach**: one line from the node's position to every reception attributed to it (the same attribution as `classifyReception`: the originator at zero hops, or the last relay of a flood), in that reception's tier colour. The star reads strong near the node and weak at its edge, and the receptions keep their own dots.

## The decisions

1. **Lines, in the tier of the hearing.** Nine renderings were drawn (R14): rays in tier colour, rays from the estimate, both, a reach polygon of the farthest hearing per bearing, only the farthest ray per bearing, ray width by signal, distance rings, the outline of the occupied hex cells, and two nodes at once. Kasper took the rays in tier colour: they show the density per direction and the gaps where nobody drove, which one shape hides.
2. **The hub is ▲ when the registry has it, else ●.** The advertised position from the resolver (members; the proxy strips it below) first; without one, the RSSI estimate over the same hearings (`estimateFor`, the node layer's rule). The hub marker is accent for the advertised position and muted for the estimate, so the two never look alike, and its title says which and how many hearings.
3. **Three ways in.** Every node in the target picker's selection has its star; "Show reach" in a point popup, a CoreScope sighting's popup and a registry node's popup toggles a star for a node that is not picked, companions included. A companion has no fixed place, so its star hangs from the estimate and reads "heard from here", not "reaches to here".
4. **Map only.** The app follows later; its map has the same core.

## What it claims, and what it does not

The star is a lower bound built from where hunters drove: unmeasured is not unreachable. It rests on an unauthenticated identity (#320): a forged sender id inflates that node's star, the same caveat Locate carries. Both are in the hub's title and the button's tooltip. Phase 2, "where can a node be that never says", is a spike and not this.

## Left out

- Persisting the popup toggles in the URL: the selection already travels; the toggles are a session's look.
- The app's map.
