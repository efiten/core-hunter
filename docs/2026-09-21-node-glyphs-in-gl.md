# The node layer's ▲, ● and hubs are GL layers, not DOM markers (#632)

**Date:** 2026-09-21
**Status:** decided (Kasper, 2026-09-21: the GL version of the artboard, halo instead of pill, the ▲ included, the hub tooltip lapses). Built in `nodeglyphs.js` (one file on both surfaces, pinned by `web/parity.test.js`), `app/src/huntmap.js` and `web/mapcore.js` + `web/map.js`.
**Related:** #197 (the layer), #425 (the label declutter), #603 (the reach stars and hubs), #623 (the selecting tap and its popup), #661 (attribution by reach), #622 (drift during a gesture), `docs/2026-09-08-coverage-overview.md`, `docs/2026-09-15-attribution-by-reach.md`

## The problem

The ▲ at a node's advertised position, the ● at our estimate and the ● hub a reach star hangs from were `maplibregl.Marker`s: elements positioned in screen space by JS on every move. A marker is not a map layer, so in the 3D view the hubs floated over the pillars at no elevation instead of standing among them, and on a phone an element can lag the canvas by a frame while a gesture runs.

## What they are now

- **The ▲**: a symbol layer (`node-adverts`). The glyph is an SDF image drawn on a canvas at 2x, so `icon-color` paints it per feature in the star's hue. The name is `text-field` in the style's own font (Noto Sans on OpenFreeMap), to the right of the ▲ as before.
- **The ● estimate and the ● hub**: one circle layer (`node-dots`), 12 px with a 2 px stroke in the background colour, the colour per feature (the hot signal colour for an estimate, the star's hue for a hub). A circle is depth-tested against the extrusions, so a hub behind a pillar is behind it.
- Both follow the terrain like every other layer. The hex labels stay DOM markers; they were not part of this.

## What stays as it was

- **The declutter decides which names print** (#425). A dropped name is an empty `text-field`; MapLibre's own collision is switched off (`*-allow-overlap`, `*-ignore-placement`), so it never hides a ▲ or a name on its own.
- **The measuring probe** (`.np-label-probe`) wears the symbol layer's font: Noto Sans, which Android ships, so the measure is exact on the phone; Arial elsewhere, the nearest metric.
- **The tap box** is the 30 px the markers carried. One click handler asks the two layers about that box and takes the nearest glyph; it runs before the point and cell handlers, so a glyph beats what is under it, as the marker did by stopping propagation. A tap in the box never counts as bare map.
- **What a tap does**: in the reach stop it selects the repeater and the popup comes back after the redraw (#623); outside it, it opens the popup. A tap on a hub selects its star.
- **Dimming**: `op` per feature, the same 0.35.

## What changed in appearance

- **A selected name** was a pill (border, background). A symbol layer has no pill: the name is heavier (12 px, the surface colour as a 2.5 px halo). Chosen from the artboard of 21 September.
- **The hub's tooltip is gone.** It was the one surface of `starLabel` (the `~` name or the id of a hub, `docs/2026-09-15-attribution-by-reach.md` answer 8 and the hub paragraph), so `starLabel` goes with it. A hub is keyed by its star's id and painted in its hue; it has no name on either surface now. Amended in that log.

## The style without glyphs

MapLibre refuses a `text-field` on a style that has no `glyphs` URL. The bare fallback style (no style host reachable) and the e2e stub are such styles, so the names are added only where the style has glyphs, and the ▲ stands alone otherwise. Before this the DOM labels showed without the style host; that is the one thing the fallback loses.

## Not in this change

- The hex labels (`hexLabelMarkers`), still DOM markers.
- #622 itself: not reproduced in headless Chromium (marker, circle and draped fill within 1 px of each other in every combination of pitch, terrain and gesture). A phone measurement is what decides it; the probe page for that was handed over on 21 September.
