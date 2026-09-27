# Export: Heard with these filters (#728)

**Date:** 2026-09-27
**Status:** decided (Kasper, 27 September 2026, on renders from real data), built in `web/exportselection.js`, `web/exportrender.js` and `web/map.js`.
**Related:** #665 (the exports epic), #666 (repeaters heard), #720 (reach of one repeater), #661 (attribution by reach), #723 (a Discover prefix on its node)

## The problem

The Export sheet draws every repeater in view (#666) or one repeater's reach (#720). What the filters select cannot be exported, such as channel messages with a 1-byte sender, or two hunted nodes together. The map shows where the selection was heard, but not where the hunters drove without hearing it.

## What it is

A third item, **Heard with these filters**: a 1200×1200 PNG of what the map's filters select in view, downloaded as `mesh-hunter-selection-<title>-YYYY-MM-DD.png`. It works for any filter: targets, packet types, id sizes, time and hunters. Nothing has to be selected on the map.

## What the picture shows

- **Heard cells** in the tier of the strongest selected reception, finer than the cells the map draws, on purpose (Kasper, 30 September 2026): the sizes the app's zoom bands gave before #734, kept as sizes (`selectionCellSize`), 180 Mercator units at z11 and 90 at z14, about a sixth and two thirds of a map cell across. The map's own cells come from the server at about 28 px at every zoom, so the numbers count finer cells than the hex layer shows.
- **Grey cells** where the same hunters drove in the window without a selected reception. They come from all the hunters' receptions, with the senders, packet types, id sizes and hops left out of the query.
- A dot at every selected reception.
- **The nodes it was heard from**, ▲ with names. A relay hash of 1 to 3 bytes is placed by reach (#661), a key or a prefix of one on the node it alone starts (#723). A picked target is placed by the same rules: a picked relay id is never placed on the one key in view it starts. A node without a name reads as its key's prefix. Only nodes in the frame are drawn and in the legend. Names that collide are dropped, the most-heard kept; a picked target keeps its name.
- **The relief** at the exaggeration from Settings, as in #720.
- **The band:** a title from the filter, the window and the hunters, and three numbers: receptions, cells heard, and the share of the cells driven that heard the selection. The title names what the stand applies: the targets or a typed prefix ("Starts with db1"), No path, then the packet types and id sizes in the bar's words, for example "Channel · 1 byte". Under the ticker's "all" the sender inputs are dropped, and so are the targets in the title. When the query for the cells driven reaches the cap, the band says so. With nothing narrowing it, the title is "Everything heard".

The map's view decides which receptions count, and the picture is fitted to them: zoom in on the map and the picture zooms with it. A node outside that frame is left off.

## What is not in it

- **No fill and no lines.** Without one repeater there is no origin to think from, and #720's model needs one.
- **Everything heard is not refused.** With nothing narrowing the selection, every cell driven heard something, and the share is 100%.
- **No larger cells when zoomed out.** The cell size follows the zoom, so at z11 a cell is a few pixels (Kasper).

## Measured on real data

Channel messages with a 1-byte sender, Nijmegen and Arnhem, 28 August to 27 September 2026:

| View | Receptions | Cells heard | Share of the cells driven |
|---|---|---|---|
| z11 | 344 | 96 | 28% |
| z14, centre of Nijmegen | 238 | 68 | 47% |

In that window no channel data (GroupData) with a 1-byte sender was heard in that area.

## Who can use it

A member, as for #666.
