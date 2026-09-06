# Terrain ships on the AWS DEM, with a button and one setting (#394, #396)

**Date:** 2026-09-05
**Status:** decided (Kasper, 2026-08-21 for the source and the default; 2026-09-05 for the button and the loading rule), implemented
**Related:** #293 (epic), #335 (the measurements), #247 and `docs/2026-07-11-3d-mode.md` (why terrain was pulled), #333 and #397 (pitch and sky), #570 (the ticker's sizes, above the same map)

## The decision of 2026-08-21 (#394), recorded here as that issue asked

- **Source:** AWS Open Data terrain tiles, terrarium encoding, key-free, attribution shown. Every option was a new external host; this one costs one source block and nothing recurring. Self-hosted Copernicus or AHN stays the upgrade path behind the same source id.
- **Low-poly cap:** the DEM source is capped at z10. Measured in #335: 127 KB per z14 screen, against 74 KB at z8 and a freeze at full resolution. MapLibre overzooms one parent tile instead of fetching the children. For RF work the landform that blocks a path is the signal, not metre-scale detail.
- **Exaggeration 7 by default**, deliberately high: the relief this has to show is the Netherlands and northern Belgium, where 1-2x shows nothing at all. It is not to be "corrected" toward realistic later.
- **Payoff accepted:** terrain earns its keep in the Ardennes and the Eifel and shows little where most hunting happens. It ships anyway, behind a button.
- **Privacy:** the DEM host sees the viewport, as the basemap host already does. The splash's "listens only" is a claim about the mesh, not about network calls; no text changes.

## What changed on 2026-09-05 (#396)

1. **A terrain button on the rail**, the sixth FAB, on or off with the accent ring, off by default (Kasper, 2026-09-06; the first cut had it on). Kasper's call over the select-with-off the issue proposed: turning terrain on while driving through a sheet is three taps. Settings keeps the exaggeration.
2. **Exaggeration in Settings**, Radio section, steps 1, 2, 4, 7 and 10, default 7, persisted like the attenuator, lighting the settings dot when off the default. The caveat is on the control: exaggeration shows which way the ground rises, not how steep it is; only 1x reads true for a line of sight.
3. **Hillshade follows the button; the mesh waits.** Shading is cheap and reads in 2D, so it follows the FAB alone. The mesh, `setTerrain`, is what froze weak GPUs in #247 and makes `easeTo({pitch})` a no-op, so it needs three things: the button, DEM tiles for the view, and a 3D view. Until the tiles are in, the map is flat, whatever the button says: that is the answer to what #394 left open, a slow host degrades to flat, never to a stalled map. Shading tracks the geometry (`hillshade-exaggeration` = exaggeration / 10).
4. **Pitch and mesh in the right order.** Leaving 3D drops the mesh before the tilt back; entering 3D tilts first and sets the mesh once the camera has settled. Both follow from the plan, so a FAB tap mid-tilt lands in the same state.
5. **A style swap re-mounts terrain** like the sky: `setStyle` drops the source, `addOverlays` puts it back under the signal layers.

## Measured

Browser at 780 px, the DEM reachable: 2D mounts with the hillshade visible and no mesh; the 3D tap eases to pitch 60 and the mesh appears at 7 once the tiles are in; the button off hides the shading and drops the mesh; back to 2D the mesh goes before the tilt returns to 0. `idle` keeps firing with terrain in, which is the event a theme switch waits on.

## Left out, and to be checked on a phone

- Whether the z10 cap is enough for the GPUs that froze in #247. The browser cannot measure that; it is the field check before merge.
- A smaller exaggeration for 3D, or a per-region default.
