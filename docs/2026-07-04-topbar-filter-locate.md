# core-hunter — Topbar filter dropdown + locate on the filtered set

> Date: 2026-07-04. Status: DECIDED — implemented in the app. Closes issue #128.
> This log records the design choices behind the topbar redesign; the "before" model
> lived in the filter FAB/sheet and the earlier include/exclude target proposal.

## What changed

Issue #128 refined the earlier include/exclude target model into a simpler one. Two pieces,
shipped together:

1. **Topbar chip + inline filter dropdown.** The target chip now reads `Select target` (was
   `No target`) to invite action. A labeled `Filters` pill sits next to it in the topbar and
   opens a **top-anchored popover** holding Direct-only, Plot-last (time window), Types, and the
   Ignored-stations manager. The old filter **FAB and bottom sheet are removed**; the remaining
   FABs (layer / discover / recenter / locate) re-space to fill the gap.

2. **Locate runs on the whole filtered set.** `locate()` is fed the same filtered record set the
   map plots (`toLocatePoints(records)` in `locate.js`), instead of re-filtering to a single
   isolated sender in `huntmap.js drawLocate`. The estimate answers "where does the traffic I'm
   currently looking at come from".

3. **Default plot window 10 min → 30 min** (`DEFAULT_FILTER.windowMs`).

## Decisions

- **Ignored-stations stays inside the dropdown** (scrollable popover) rather than moving to Settings.
- **Labeled `Filters` pill** (sliders icon + word + caret + active-dot badge), not an icon-only button.
- **Top-anchored popover**, not a bottom sheet — it reads as a true dropdown from the topbar.
- **Locate is always available** — the FAB/overlay is no longer gated on having a sender isolated.
  It runs over the filtered set including **multiple / rotating senders**. This is deliberate: a
  spammer can generate and rotate IDs on the fly, so the common factor to target is the *traffic*
  (e.g. a packet-type filter such as DM traffic), not a single fixed ID. Locating over "all senders
  matching the current filter" is a legitimate targeting tool. When nothing is plotted yet, no
  readout is shown (rather than a meaningless "0 points").

## Explicitly out of scope

- **Relayed (non-zero-hop) receptions** are still included in locate exactly as before — no `hops=0`
  change here. Whether Locate (and/or the default map view) should force `hops=0` is the separate
  open question in issue #173 (see also #138).
- The §7 position disclaimer is unchanged: it is still appended to every locate readout branch.
