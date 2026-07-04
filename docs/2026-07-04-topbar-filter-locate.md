# core-hunter — Topbar filter dropdown + locate on the filtered set

> Date: 2026-07-04. Status: DECIDED — implemented in the app. Closes issue #128.
> This log records the design choices behind the topbar redesign; the "before" model
> lived in the filter FAB/sheet and the earlier include/exclude target proposal.

## What changed

Issue #128 refined the earlier include/exclude target model into a simpler one. Two pieces,
shipped together:

1. **Topbar segmented control: target · filters · locate.** The target chip reads `Select target`
   (was `No target`) to invite action. It sits in a **connected segmented control** with a `Filters`
   segment and a `Locate` checkbox, so the three read as one unit. Both the target picker and the
   filters open as **top-anchored popovers** (the target picker is no longer a bottom sheet); the
   filter popover holds Direct-only, Plot-last, Types, and the Ignored-stations manager. The old
   filter FAB, filter bottom sheet, and locate FAB are **removed**; the remaining FABs (layer /
   discover / recenter) re-space. On the topbar's right, the settings gear becomes a **hamburger
   menu** and the BLE/MQTT status shrinks to two small **stacked dots** beside it (freeing the width
   the segmented control needs on a narrow phone).

2. **Locate runs on the whole filtered set.** `locate()` is fed the same filtered record set the
   map plots (`toLocatePoints(records)` in `locate.js`), instead of re-filtering to a single
   isolated sender in `huntmap.js drawLocate`. The estimate answers "where does the traffic I'm
   currently looking at come from".

3. **Default plot window 10 min → 30 min** (`DEFAULT_FILTER.windowMs`).

## Decisions

- **Ignored-stations stays inside the filter popover** (scrollable) rather than moving to the menu.
- **Connected segmented control** for target · filters · locate; active filter reads accent (no
  floating badge — it would clip against the segment divider).
- **Top-anchored popovers**, not bottom sheets — target and filters both drop down from the topbar.
- **Locate is a styled checkbox, default OFF.** Toggling it shows/hides the overlay + readout; the
  estimate keeps computing underneath so switching on is instant. It runs over the filtered set
  including **multiple / rotating senders** — deliberate: a spammer can generate and rotate IDs on
  the fly, so the common factor to target is the *traffic* (e.g. a packet-type filter such as DM
  traffic), not a single fixed ID. When nothing is plotted, no readout is shown.
- **BLE/MQTT status** drops its text labels for two stacked dots (detail still lives in the menu);
  the settings entry point is now a hamburger.

## Explicitly out of scope

- **Relayed (non-zero-hop) receptions** are still included in locate exactly as before — no `hops=0`
  change here. Whether Locate (and/or the default map view) should force `hops=0` is the separate
  open question in issue #173 (see also #138).
- The §7 position disclaimer is unchanged: it is still appended to every locate readout branch.
