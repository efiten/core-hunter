# Export: Reach of one repeater (#720)

**Date:** 2026-09-27
**Status:** decided (Kasper, 27 September 2026, on renders from real data), built in `web/exportreach.js`, `web/exportterrain.js`, `web/exportrender.js` and `web/map.js`.
**Related:** #665 (the exports epic), #666 (export 1, repeaters heard), #603 (the reach layer), #723 (a Discover-heard star under its own ▲), #396 (the terrain tiles)

## The problem

A hunter who wants to show how far one repeater reaches has only the map. The reach layer draws every repeater at once, and a URL only shows the same thing to someone with an account and the same filters.

## What it is

A second item in the Export sheet: **Reach of one repeater**, a 1200×1200 PNG of the selected star, downloaded as `mesh-hunter-reach-<name>-YYYY-MM-DD.png`. A star is selected by tapping its ▲ or by picking it as target. Without a selection the item is disabled and says: "Select one repeater on the map: tap its ▲, or pick it as target." A merged target row is one repeater under several ids; when its hearings form two stars (a key the registry does not place, say), the star with the most hearings is drawn (Kasper, 30 September 2026). The cells use the type and hop filters of the map: with a type filter on, a grey cell means not heard as that packet type (Kasper, 30 September 2026).

## What the picture shows

- **Heard cells** (the export's cell of #666, res 13 since #734, about 330 m point to point) in the RSSI tier colour of their strongest hearing. A strong cell is more opaque than a faint one.
- **A ray** from the origin to the strongest hearing in each heard cell, in its tier colour, and a dot at every hearing.
- **Mapped, not heard:** the cells the same hunters drove through without hearing this repeater, in grey.
- **Filled-in cells**, lighter: where the repeater reaches between its hearings (the next section). Their colour is the mean RSSI of the 6 nearest hearings, weighted by one over the distance squared.
- A ▲ "adv." at the advertised position and a ● "est." at the RSSI estimate, with a dashed line between them. The rays leave from the ▲, or from the ● when the registry has no position.
- **The relief**, shaded at the exaggeration from Settings, as the 3D view and the Repeaters heard export shade it, with "relief 7× exaggerated" beside the scale bar. The fill is checked against the real heights, not the exaggerated ones.
- **The band:** the repeater's name, the window and the hunters, three numbers (receptions, strongest, farthest) and a legend with the RSSI tiers, mapped not heard, the ▲ and the ●.

## What is filled in

Thought from the repeater (Kasper). The signal goes out in straight lines:

1. **Lines.** One line from the repeater to the strongest hearing in each heard cell.
2. **Stretches.** A line is reached from the repeater, or from a heard cell on it, up to the next heard cell. A cell driven through without hearing it is a shadow: the line is dark from there until it is heard again. Heard at 1, 2 and 3, not at 4 and 5, and again at 6, 7 and 8 fills 1 to 3 and 6 to 8. The repeater's own cell never darkens a line.
3. **One line, several places.** A line to a cell that a longer line passes through is part of that longer line.
4. **Between neighbouring lines**, the area where both lines are reached is filled, out to the ends of their stretches. This holds when those ends are at most **2 km** apart, no silent cell lies in the area, and the two lines are less than 180° apart. From the repeater, that area is the wedge between the two lines.
5. **Terrain.** A cell is filled only where the repeater sees it over the ground. The ground comes from the Terrarium tiles the 3D view draws, at zoom 10 (pixels of about 95 m). The line runs from 30 m above the repeater's ground, the height the 3D rays already leave from (`RAY_ALT_M`), to 1.5 m above the cell. The earth bulges between them, with its radius times 4/3 for the bending of the air. The Fresnel zone is not kept clear.
6. **Without the terrain**, the lines alone decide. That happens when a tile does not load within 8 s, or when the star spreads over more than 64 tiles. It also happens when the browser alters what a canvas reads back, as some do against fingerprinting: one bit of red off is 256 m of ground. MapLibre checks for the same with `isOffscreenCanvasDistorted`.

Heard and mapped cells are measurements and are never filled.

## Measured on real data

Receptions around Nijmegen and Arnhem, 8 August to 8 September 2026. Filled cells on flat ground and over the real terrain:

| Repeater | Heard cells | Filled, flat ground | Filled, with terrain |
|---|---|---|---|
| NL-NIJ-Dikkeboom | 85 | 45 | 40 |
| Stollenberg | 23 | 83 | 77 |

Of the 29 stars with at least 20 hearings, the terrain removes cells for 4. For Stollenberg, on the moraine east of Nijmegen, they are 6 cells on the Waal side of the city centre. There the ridge of the centre (26 to 33 m) is 0.7 to 3.2 m higher than the line from the mast.

## What was tried and not chosen

- **Triangles between hearings** (Delaunay, sides up to 2, 2.5, 3, 3.5 or 5 km): fills across places the repeater may never reach, without a line from the repeater.
- **A silent cell breaks the whole line:** fills 12 of Dikkeboom's cells, and nothing past a single shadow.
- **Filled cells over mapped ones at half the opacity:** a mapped cell is a measurement and stays one.
- **The route line:** the heard and mapped cells already show where the hunters drove.
- **A legend item for the filled cells:** three wordings; none is used.
- **A note on the exaggeration in the legend:** it sits beside the scale bar instead, with the other facts about the map.
- **Nothing filled without the terrain:** the lines alone decide instead.

## How it is drawn

As for #666: a second MapLibre instance offscreen, and a canvas for the glyphs, the scale bar and the band. The model fetches the terrain tiles for each export: the tiles under the box around the repeater and its hearings, padded by 0.01°. The relief is MapLibre's hillshade layer on the same tiles, added once the camera is on the repeater.

## Who can use it

A member, as for #666.
