# Export: Repeaters heard (#666)

**Date:** 2026-09-27
**Status:** decided (Kasper, 27 September 2026, on mockups rendered from real data), built in `web/exportheard.js`, `web/exportrender.js`, `web/exportsheet.js` and `web/map.js`.
**Related:** #665 (the exports epic), #720 (export 2, reach of one repeater), #603 (the reach layer), #723 (a Discover-heard star under its own ▲), #561 (the narrow bar)

## The problem

A hunter who has just mapped a stretch of road cannot show it. The reach layer draws every repeater's star, but the only thing to pass on is a URL, which the other person has to open with the same filters and an account to see the same thing.

## What it is

An **Export** button in #bar, next to Start mapping, opens a sheet with one item: **Repeaters heard**, a 1200×1200 PNG of the map as it stands (filters, time window, hunters), downloaded as `mesh-hunter-repeaters-heard-YYYY-MM-DD.png`. Below 900 px the button moves into the menu; Start mapping and Log in follow below 640 px (#561). Between 641 and 900 px its label wrapped the bar into another row: at 768 px as a guest, in a font as wide as the CI runner's, the bar was 90 px high with it and 64 px without.

## What the picture shows

- **The stars the reach layer draws for the view**, built from the same registry slice, window receptions and attribution, whether the layer is on or not. A star is drawn when its origin is in view.
- **Every repeater in its own hue** (`assignHues`), as on the map.
- **Strength as a gradient within the hue**, per ray: strong full and thick, weak lighter (mixed up to 55% towards white) and thinner. Width and opacity are the map's (`rayStyle`).
- A dot at every hearing in the same tint. A ▲ in the hue at the advertised position, a ● where there is only an RSSI estimate.
- **Names** as text on a white halo, in the hue. A key without a registry name reads the resolver's name, a relay hash never does (AGENTS.md §7 rule 2) and reads `#id`. Most-heard first; a name that would print over another (4 px margin) or off the image is dropped, the ▲ never.
- **Mapped cells** in grey: the resolution of `hexgrid.js` (now copied whole into web/ and pinned) whose size is closest to 360 Mercator units, about 445 m point to point at 52°N (res 8 of today's table), so the cell stays when the table changes; and the **route** in grey, broken on a gap of more than 5 minutes, more than 3 km, or another hunter.
- A star whose nearest hearing is more than **30 km** from its origin is left off and named in the band.
- **The band:** the mark and mesh-hunter.eu, "Repeaters heard", the window as dates and up to three hunters by name, what was left off, three numbers (repeaters, receptions, farthest in km), a legend, and the tile attribution on the map.
- The **light theme**, whatever the page shows: it is a picture passed on to people who never chose a theme.

## What was tried and not chosen

- Name labels as pills: busier than the #720 reference's halo text.
- **Colour per signal tier** (the #720 style) for all repeaters: which repeater heard what is lost.
- **#720's hex fill** over every repeater (the strongest per cell wins): a weak repeater disappears under a strong one, and a few far hearings fill a large area. It stays for #720, which has one repeater.

## How it is drawn

A second MapLibre instance, offscreen at 1200×1000, draws the base map, the cells, the route, the rays and the dots; it is the only one with `preserveDrawingBuffer`, so the live map is untouched. A canvas takes its pixels and adds the glyphs, the names, the scale bar, the attribution and the band. When the hosted style does not load within half the timeout, the bare background is used, and the lines and the band still say what was heard.

## Who can use it

A member, like the node positions the picture is made of. Anyone else sees the item disabled with why: "Exports need an account. Log in to use them." or, for a hunter, "Exports need a verified member account. An admin verifies you."
