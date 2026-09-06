# The website's map is the app's map (#465)

**Date:** 2026-09-06
**Status:** decided (Kasper, 2026-09-06: "port the map to the same map as the app", 2D parity first), implemented
**Related:** #147 (the app's move to MapLibre), #238 (why shared modules are copies), #427 (the controls' theme), #218 (the neutral first view), #224 (ticker sync), #197 (node positions), #465

## What changed

The website drew its map with Leaflet 1.9.4 on Carto raster tiles while the app had moved to MapLibre GL on OpenFreeMap's vector styles (#147). Two engines meant two basemaps, two colour treatments of the same tokens, and no road from the map to the 3D views the app has. `web/map.js` now builds its map from `web/mapcore.js`, a port of `app/src/huntmap.js`'s shape: the same two styles, the same bare-background fallback when the style host is unreachable, the same sky, and every overlay re-added on each style load because `setStyle` drops them.

- **Data layers are GeoJSON sources** with one `setData` each, built by `web/mapmodel.js`, which the unit suite covers: points (circle, tier colour and opacity), hex cells (fill plus a thin outline, from the server's heatmap cells), the two CoreScope layers (dot for an advert, ring for a relay), Locate's inliers and outliers, the node-position connector and circles, and the ticker's playhead ring. A collection is swapped whole, so the previous answer stays up until the next one is in (#317), and a collection handed over before the style has loaded is replayed once the layers exist.
- **Locate's density cloud** is an image source over the grid's bounds; the bytes come from the same ramp and floor as before (`heatImageData`).
- **Markers** (Locate's centroid and strongest, the node ▲ with its decluttered label, the estimate ●, the hunter pin) are MapLibre markers on elements, in named groups so a layer clears its own.
- **Popups** are MapLibre popups, one at a time; their open/close reaches the name-resolution deferral (#271) as before. The hex cell's tooltip is a closeless popup that follows the pointer, since MapLibre has none.
- **Zoom keeps Leaflet's numbers on the outside.** MapLibre counts against a 512 px world, Leaflet against 256, so the same scale is one level apart. `?z=` in shared links and the `z` the server bins hex cells by both stay in Leaflet units; `leafletZoom` and `mapZoomFromLeaflet` convert at the edge, so every existing link lands where it did and no cell changes size.
- **The controls follow the theme** through MapLibre's own class names, with the double-class attribution selector the #427 lesson asked for, and the hover and disabled states asserted the same way.
- **`web/sky.js`** is the app's copy, pinned by the parity suite.

## What stayed

Every filter, picker, the ticker sync, the ignore list, urlstate, the auth gates and the notices are untouched: they talked to the map through bounds, zoom, centre, a click and a popup, and those are the calls `mapcore.js` offers.

## Verification

Unit: 522 web tests, the model tests for the collections, the heat bytes and the zoom convention among them. e2e: all 199 pass under Playwright's Chromium, which renders MapLibre through SwiftShader; the fixtures answer the hosted style with an inline bare style so `load` fires offline and at once. The specs that counted Leaflet's SVG paths now count a source's features through a page hook, and click a coordinate through `__mapProject`, since a canvas has no element to click.

## Left out

- 3D on the website: the core carries it (pitch, extrusions), the controls do not yet. A follow-up on #465.
- A zoom-to-fit animation: `fitBounds` jumps, as the app's does.
