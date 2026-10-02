# The noise floor per cell, as a map layer (#410)

**Date:** 2026-09-25
**Status:** decided (Kasper, 2026-09-25), built in `app/src/noise.js`, `app/src/queue.js`, `app/src/huntmap.js`, `app/src/app.js` and `app/src/filtersheet.js`. App only; the map has no noise data.
**Related:** #277 (a silent stretch: out of coverage or drowned in noise), efiten/coredrive-rx `src/rfstats.js` (the same reading, ported in part)

## The problem

A stretch with no receptions reads the same whether it was out of coverage or drowned in noise. Those call for opposite moves: drive closer, or look for the source. The companion measures its noise floor; nothing kept it.

## The reading

- `CMD_GET_STATS` (56) with `STATS_TYPE_RADIO` (1), answered by `RESP_CODE_STATS` (24): `docs/stats_binary_frames.md` in meshcore-dev/MeshCore. Only the noise floor is read, an int16 in dBm. The firmware holds it at 0 until it has averaged 64 samples, after a start and after every AGC reset (`RadioLibWrappers.cpp`), so 0 and anything above it is no reading, as is anything below -140 (the firmware clamps at -120).
- A local BLE query: nothing goes on the air. So it runs whenever a companion is connected, auto-discover on or off.
- **Rhythm:** auto-discover's, every 10 s or sooner after 50 m (`INTERVAL_MS`, `MOVE_THRESHOLD_M`).
- **No fix, no sample.** A reading needs a place.
- **Three misses in a row** (older firmware has no stats) and the companion is not asked again until the next connect.

## What is kept

- One row per sample in the `noise` store (IndexedDB v5; v4 is #554's tracks): time, place, accuracy, noise floor, the connection it belongs to, the companion's key, and whether it was stationary.
- **Session = one connection.** A sample within 50 m of the previous one is stationary.
- **Retention 7 days**, by age alone: samples are never published, so no watermark holds them.
- **The layer reads at most 20,000**, the newest: a week past that drops its oldest drive, not the latest.

## The layer

- **Always cells**, whatever the view (points, hex + points, hex, 2D or 3D). A noise floor is a property of a place, not of a reception.
- **Drawn as soft spots, not hexes** (amended 28 September 2026, Kasper, on the review of #708). Hexes read as the signal cells, while a noise floor is a property of the place around the sample. Each cell is one blurred circle at its centre (`circle-blur` 0.8, opacity 0.6), 1.3 times the cell's radius so neighbours flow into each other, sized on the ground by the zoom (`noiseRadius`, `PX_PER_MERCATOR_M_Z0`). The cells, the medians and the labels are unchanged.
- **It replaces the signal cells** while it is on: `hex`, `hex-3d` and the hex labels step aside, the points stay on top. Laid over the signal cells, blue on orange mixed into grey and olive and neither read (artboard of 25 September, variants C over and D stripes).
- **The value per cell is the median.** The stationary samples of one connection in one cell count once, as their own median: ten minutes parked is one place, not sixty readings of it.
- **Colour:** clear below -119 dBm, then four bands at -119, -113, -107 and -101, blue that gets stronger as it gets louder (`--ch-noise-1..4`). Blue-to-black was tried first: black on the dark basemap hid exactly the loud cells.
- **Flat in 3D.** A noise floor has no height to give a pillar; the spots lie on the map (`circle-pitch-alignment: map`).
- **No legend.** The hint under the switch says what the colour means.
- **The value itself** (#708, Kasper, 27 September). Each cell carries its median in whole dBm,
  fading in with the cell names (zoom 15.5 to 16.5, #634), on the hex-label markers the noise cells take over while the layer is on, read from
  the same cells the fill draws. The HUD shows the latest reading, `Noise -104 dBm`, while the layer
  is on and the companion answers; a miss, the firmware's 0 or a reading older than three rounds
  (30 s, since without a fix nothing is asked) leaves the line empty.

## Where the switch is

A checkbox, "Noise floor", in a Map group at the end of the filter sheet. It is a setting, not a filter: kept across launches, and Clear filters leaves it alone. It sits there until the map has settings of its own.

## Not in this change

- The web map: it has no noise data, and no follow-up is filed.
- Sending the samples anywhere. They stay on the phone.
