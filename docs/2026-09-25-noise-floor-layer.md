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

- **Always hex cells**, whatever the view (points, hex + points, hex, 2D or 3D). A noise floor is a property of a place, not of a reception.
- **It replaces the signal cells** while it is on: `hex`, `hex-3d` and the hex labels step aside, the points stay on top. Laid over the signal cells, blue on orange mixed into grey and olive and neither read (artboard of 25 September, variants C over and D stripes).
- **The value per cell is the median.** The stationary samples of one connection in one cell count once, as their own median: ten minutes parked is one place, not sixty readings of it.
- **Colour:** clear below -119 dBm, then four bands at -119, -113, -107 and -101, blue that gets stronger as it gets louder (`--ch-noise-1..4`). Blue-to-black was tried first: black on the dark basemap hid exactly the loud cells.
- **Flat in 3D.** A noise floor has no height to give a pillar.
- **No legend.** The hint under the switch says what the colour means.

## Where the switch is

A checkbox, "Noise floor", in a Map group at the end of the filter sheet. It is a setting, not a filter: kept across launches, and Clear filters leaves it alone. It sits there until the map has settings of its own.

## Not in this change

- The web map: it has no noise data, and no follow-up is filed.
- Sending the samples anywhere. They stay on the phone.
