# A node's estimate is made of the whole window, not of the view (#664)

**Date:** 2026-09-21
**Status:** decided (Kasper, 2026-09-21, on the fetch and its cache). Built in `web/windowpoints.js` and `drawNodePositions` in `web/map.js`.
**Related:** #197 (the node-position layer), #377 (the registry decides which nodes are drawn), #603 (the reach stars), #661 (attribution by reach), `docs/2026-09-08-coverage-overview.md`, `docs/2026-09-15-attribution-by-reach.md`

## The problem

The node-position layer fetched its receptions with the viewport's bbox, the query the point layer uses. The server narrows `/api/points` to that box, so a node's RSSI estimate (●) was computed over the hearings on screen. Measured on map.mesh-hunter.eu on 15 September 2026: the estimate of one repeater stood about 650 m apart in two views, and returned to the same coordinate with the first view. The ● hub of a reach star is the same estimate and moved with it.

## The rule

The view decides which nodes are drawn. It does not decide what their estimate is made of.

- The layer asks for the receptions of the time window under the active filters, with no bbox. The registry slice still follows the view, padded by the reach (#661).
- The reach stars are built from the same rows. With a sender picked they are fetched without the sender filter, as before (#603), and also without a bbox.
- The cap stays 25,000 rows, newest first (`ORDER BY rx_at DESC`). A window that holds more is estimated over its newest 25,000. That depends on the window and not on the view, which is the point here. The cost is accepted (Kasper, 2026-09-23): every draw and every live tick pulls up to 25,000 rows in 5 pages, also when zoomed in tight, and on a window past the cap a node in view can get fewer hearings than the bbox query gave it.

## The cache

Without a bbox the query is the same from pan to pan, so the draws between two live ticks share one fetch (`createWindowCache`).

- The key is the filters plus the range as the fields hold it (`now-12h`), not the resolved range. `currentFilters()` resolves a relative range against the clock on every call, so a resolved `from` never matches the draw before it.
- An entry lives 9 s, a little under the live tick's 10 s (`timeRangeTimer`): an entry is stamped when its fetch starts, so one as old as the tick would be reused by the tick itself and the stars would run up to 20 s behind. A rolling window picks up new receptions on the tick as before; a pan in between costs no request. Before this, every pan fetched the layer's rows again. A fetch still out is joined, not doubled.
- Keyed, because a draw with a sender picked wants two sets. A failed fetch is not kept.

## Not in this change

- The app. It pairs from its local store, which has no bbox.
- A server-side estimate per node. It would take the rows off the wire altogether; it is Go work with its own issue, and was set aside on 21 September 2026 in favour of this.
- #622 (drift during a gesture) and #632 (hubs over the 3D scene) are about how the markers are drawn, not about what the estimate is made of.
