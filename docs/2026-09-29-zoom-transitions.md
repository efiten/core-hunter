# 2026-09-29: zoom transitions and one hex system (#634)

## Context

Everything the map showed or hid by zoom was a step in JS: a threshold crossed, the data rebuilt, the
thing there or gone in one frame. Five rules did this: the hex resolution bands, the outlines of
earlier rides, the cell names, and on the website the server's resolution per zoom level. Hex and
points together was a manual view, `both`.

The two surfaces also binned their cells differently. The app had ten bands of a fixed size, 1500
down to 3 Mercator units. The server gives a size per zoom level, about 28 px tall at every zoom
(`server/internal/geo/hexgrid.go`).

## Decision

Kasper picked the numbers on 29 September 2026 in a mockup: a MapLibre page with 4559 receptions
between Nijmegen and Arnhem, a slider per threshold, 2D and 3D, the app's and the server's cell sizes
side by side, judged by pinching through it on a phone.

| | 2D | 3D |
|---|---|---|
| Points of this ride | fade in from zoom 13.25 to 18.25 | one step at zoom 19 |
| Hex | stays at 100% | 95% of the bar height from zoom 19 |
| Earlier rides | fade in from zoom 11.25 to 18.75 | with the points, at zoom 19 |
| Cell names | fade in from zoom 15.5 to 16.5 | not drawn in 3D, as before |
| Two cell sizes | blend over 0.95 zoom level | blend over 0.75 zoom level |

Zoom is MapLibre's. The numbers live in `zoomfade.js`, one file on both surfaces.

- **One hex system, the server's.** The app takes a size per zoom level and gives up its bands.
  This amends `docs/2026-06-29-hex-resolution-zoom.md`.
- **Auto replaces `both`.** Hex and points together, each at the share its zoom gives it. `hex` and
  `points` draw one layer at full strength at every zoom. On the website a stored view or a link
  that still says `both` reads as auto. In the app a stored `both` falls back to the default, auto
  in 2D, so a stored `both3d` opens in 2D once; no migration, since the app is in development.
- **In 3D the pillars wait for zoom 19.** A pillar per reception is the most expensive thing on the
  map. Up to there the bars are the view. From there the bars stand at 95%, so the strongest
  pillar of a cell clears its bar. Until now the hex was drawn flat whenever pillars shared the
  scene (#266).
- **The hex does not fade out.** The issue had it fading out as the points came in. In the mockup
  the hex at full strength under the points read better.

## How it is drawn

- A share is a zoom expression on the layer, so the map eases it while the fingers move and no
  draw is needed for it.
- **Two hex layers.** Resolution r is drawn from zoom r - 1.5 to r - 0.5. Around each end it hands
  over to its neighbour over the blend width, so at most two sizes are on the map and their shares
  add up to 1. The even resolutions go to one layer and the odd ones to the other. The pair moves up
  at every whole zoom, where the size that stays is at 100% and the other two at 0, so the swap
  is not seen.
- **The website asks for two sizes**, one request each, by its own `z`. Where the server answers
  both with the same size (below member it caps the zoom), that size is drawn once and stays in
  full.
- **The website holds the pair it fetched.** It refetches on `moveend`, so a pinch can run past
  the pair before the next one arrives. The two sizes held are the whole range the ramps know of:
  the coarser stays in full below its level and the finer above it, as before this change the old
  cells stayed until they were replaced.
- **Only what is drawn in full takes the pointer.** Both sizes are loaded, and hover, click and
  `queryRenderedFeatures` ignore paint opacity. A cell answers only from the size drawn in full at
  the zoom (the one the line under the map counts), a point only from half its strength on
  (zoom 15.75 in 2D auto).
- **The app redraws by what changed.** A zoom step that only moves a share draws nothing. One
  that changes a size rebuilds the cell layers, the noise and the labels, which change size at
  every half zoom. Only a layer whose share leaves nothing takes the full draw.
- **Nothing is built for a share of 0.** In auto the points are not built, and on the website not
  fetched, below the zoom that shows them.

## Measured in MapLibre 4.7.1

- `['zoom']` is only accepted as the input of a top-level `interpolate` or `step`. A per-feature
  value such as `['get', 'op']` therefore rides in each stop's output.
- A `fill-extrusion` of height 0 still draws an opaque polygon on the ground. A layer with nothing
  to show is switched off with a `step` on `fill-extrusion-opacity`, 0 or 1.
- A bar cannot fade by alpha: a translucent extrusion blends against black
  (`docs/2026-09-04-new-versus-old-on-the-map.md`). In 3D a share is spent on the height.

## Limits

- **The finest cell differs, by choice** (Kasper, 2026-09-29). The server stops at resolution 18. The app goes to 21, so a cell
  stays 28 px up to zoom 20 for the walk-in: 2.1 Mercator units, where the old bands ended on 3.
  On the website a cell grows past 28 px above zoom 17.
- **A cell names one node.** Three prefixes at 10 px need about 100 px, and a cell is 28 px tall
  and about 24 wide at every zoom, so the names of neighbouring cells ran over each other. The
  label is the prefix of the node heard last, with the count of the others on a line under it
  (Kasper, 2026-09-29). The old bands gave a cell of about 110 m at zoom 16, which held three.
- **The noise layer (#410) draws one size**, the one in full at the zoom, without a blend.
- **The website has no earlier rides and no cell names**, so those two fades are the app's alone.
