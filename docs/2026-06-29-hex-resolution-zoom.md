# 2026-06-29 — Zoom-scaled hex-heat resolution (down to 3 m)

## Context

The hex-heat layer ([`huntmap.js`](../app/src/huntmap.js) + [`hexgrid.js`](../app/src/hexgrid.js))
aggregates zero-hop receptions into hex cells, keeping the best RSSI per cell, to surface the
hotspot to drive toward (see the Vraag 4 / heatmap decisions in
[`2026-06-29-iteration-2-proposals.md`](2026-06-29-iteration-2-proposals.md)).

Until now the live map binned at a **fixed** resolution 11 (≈40 m cells), mirroring the server's
`zoomToHexRes` floor. That is fine while driving toward a target, but during the final close-range
walk-in — where you are within tens of metres and zoomed all the way in — 40 m cells are far too
coarse to distinguish *where exactly* the strongest signal is. The map has the data to show finer
structure; the binning was throwing it away.

## Decision

**Scale the hex-heat resolution with the map zoom, extending the existing coarse bands with finer
cells down to 3 m at maximum zoom.** The change is live-map only; the server's binning is unchanged.

- `hexResForZoom(z)` adds bands above the previous res-11 ceiling: zoom ≥16 → res 12, ≥17 → 13,
  ≥18 → 14, ≥19 → 15. Coarser bands (res ≤11) are kept exactly as before, so behaviour while zoomed
  out is unchanged.
- `hexSizeForRes(res)` adds the matching cell sizes: res 12/13/14/15 → 20/10/5/3 m. The existing
  sizes (res ≤11 → 40 m and up) are unchanged.
- `huntmap.js` now derives the binning resolution from `map.getZoom()` per render instead of the
  hardcoded `11`, so cells get finer the more you zoom in for close-range localization.

This keeps the server↔app relationship intact for the shared coarse range and only *extends* the
app past the server's 40 m floor where the operator has explicitly zoomed in to pinpoint.

## Caveat — below GPS accuracy (mirrored from the code comment)

The finest cells (5 m, 3 m) are **smaller than typical phone-GPS accuracy**. At that scale a single
reception's stored coordinate is mostly noise, so an individual cell is not a trustworthy "the target
is in this 3 m square" claim. The value is in **aggregation**: many receptions still pile up into a
visible hotspot whose centre is meaningful even when each point is noisy. The 3 m floor is therefore
a deliberate, recorded choice — finer detail for the eye during walk-in, not a precision claim.

This does not change the standing position disclaimer (AGENTS.md §7): position is inferred from radio
measurements via mesh topology, and the stored GPS is the hunter phone's own position at reception
time, not the target's.

> **Amended 2026-09-15 by `docs/2026-09-15-position-notices.md` (#662).** The statement above stays true,
> and AGENTS.md §1 carries it. The §7 rule that required it in every position-bearing output was
> removed.

## Watch-outs

- **Render cost.** At res 15 over a dense session this rebuilds many small `L.polygon`s on every pan
  and zoom. Fine at street-level bbox; revisit (e.g. cap cells or simplify geometry) if zoomed-in
  panning over a large dataset feels sluggish.

## Tests

`hexSizeForRes` / `hexResForZoom` stay pure and are pinned in
[`app/src/__tests__/hexgrid.test.js`](../app/src/__tests__/hexgrid.test.js): the kept coarse bands,
the new 20/10/5/3 m bands, and the clamp at the extremes.
