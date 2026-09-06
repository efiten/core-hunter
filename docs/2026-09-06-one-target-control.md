# The map has one control for targets (#498)

**Date:** 2026-09-06
**Status:** decided (Kasper, 2026-09-06), implemented on the MapLibre map (#465)
**Related:** #223 (the two sender params), #288 (why the pick is a Set), #299 (typing drops a pick), #449 (the app's sheet got its search), #495 (the selection on the button), #573 (moves the same field into the filter panel; on a rebase the move here wins)

## What changed

The map filtered targets with two controls side by side: a typed leading-prefix box (`#f-sender`, the server's `?sender=`) and the picker button (`#sp-toggle`, exact ids as `?senders=`). They matched differently, could not both be active, and the rule that resolved it was invisible. The app has one control: the target chip opens the sheet, and the sheet holds the search.

- **The prefix field lives inside the picker's panel**, above the Top rows, styled as the app's sheet search. Same element id, so urlstate, `filters.js`, the `?sender=` links and `onPick` (a pick clears the prefix) work unchanged.
- **The search is the server's prefix match** (Kasper's call, over the app's client-side row filter): typing narrows the map through `?sender=`, and can find a node that has no row in view. Old `?sender=` links keep narrowing the map.
- **The button carries the trace.** With no pick and a prefix typed it reads `⌖ 4a2b…` and lights up, the way it does for a pick; clearing the field or Clear filters takes it away. Once the panel closes the button is the only thing left on screen, the lesson #495 recorded.
- **"Locate this sender" in a popup picks the node** (an exact id) instead of filling the prefix. Locate reads the pick, so it follows.
- The onboarding callout no longer names the field; it points at the picker button and its neighbours.

## Left out

- Filtering the rows client-side by name as the app does; the server prefix was chosen instead.
- #573's placement of the field in the filter panel; this supersedes it.
