# core-hunter — Iteration 4 design: live Messages feed

> Status: **approved** (2026-06-29). Frontend-only; builds on the iteration-3 decoder/sender model.
> Workflow: GitHub issue → branch `feat/messages-feed` → SDD → PR against `master` (testable flow).

## Problem

After iteration 3 the decrypted channel sender + text only appears when you **tap a point's popup**. There is no feed — to watch a public-channel spammer while driving you'd have to tap every dot. The hunter needs a live list that streams identified activity as it arrives.

## Goal

A **live Messages panel** that lists recent **decrypted channel messages + adverts** (the identified, named activity) newest-first, tappable to jump to the map and to Isolate/Ignore — without tapping individual points and without any backend/storage change.

## Decisions (locked)

1. **Feed scope:** `sender_kind ∈ { channel_name, advert_pubkey }` only. No raw `direct_hash` rows.
2. **Filtering:** **ignore-list applied** (Ignored senders hidden); otherwise independent of the map's isolate/time-window filters (so isolating one sender on the map doesn't empty the feed).
3. **Layout:** bottom **collapsible panel** — a `Messages (N)` handle above the HUD; tap to expand a scrollable list, newest on top.
4. **Row content:** RSSI (the default signal metric) + sender label + — for channel rows — the decrypted **text**, plus relative time (`12s`/`1m`). Advert rows show the node name/pubkey + an `advert` tag. **No hop badge** (every captured reception is zero-hop by the capture rule, so it would be noise).
5. **Tap a row** → centre the map on that reception + open its popup. Inline per-row actions **Isolate sender / Ignore this ID** (same `hunt:isolate-sender` / `hunt:ignore-sender` events as the popup).
6. **Local/display only:** the feed reads the same IndexedDB record snapshot the map uses; decrypted text is **HTML-escaped** and **never stored server-side or published** (it persists locally in IndexedDB as part of the record, but is stripped before any MQTT publish; unchanged from iter-3). **No `server/` change.**
7. **Popup cleanup (folded in):** remove the redundant `hops 0 ·` from the marker popup — show just the packet type — since everything displayed is zero-hop.

## Architecture & module map (`app/src/`)

```
render tick (existing, ~1s):
  records = queue snapshot (IndexedDB)         (existing)
  map.render(visible, now)                     (existing)
  feedItems = feed.feedItems(records, {ignore: state.ignore, limit: 50})   (NEW)
  feedpanel.render(feedItems, now)             (NEW)
tap a feed row → map.focusReception(rec)       (NEW small method) + popup
                 / dispatch hunt:isolate-sender|hunt:ignore-sender (existing events)
```

- **`feed.js` (new, pure):** `feedItems(records, { ignore, limit })` → array filtered to `sender_kind ∈ {channel_name, advert_pubkey}`, dropping any whose `sender_id` (lowercased) is in `ignore`, sorted by `rx_at` descending, capped to `limit`. Unit-tested.
- **`feedpanel.js` (new, DOM):** renders the collapsible panel + `Messages (N)` handle, the row list (RSSI · label · text · relative time · `advert` tag), the new-item highlight, and wires row tap + the two inline action buttons. Glue — verified by build + field test.
- **`app.js`:** build `feedItems` from the existing snapshot in the render tick; pass `state.ignore`; drive the panel; relative-time refresh rides the existing tick.
- **`huntmap.js`:** add `focusReception(rec)` (setView to `rec.lat/lon` + open that marker's popup); remove the `hops 0 ·` prefix from `popupHtml`.
- **`index.html` + `src/styles/`:** the panel DOM + `--ch-*`-token styling (distinct, consistent with the HUD).

## Data

Each feed item comes from a local record already carrying: `sender_kind, sender_id, sender_label, channel_name, _text` (local-only decrypted text), `rssi, snr, rx_at, lat, lon, packet_type`. Channel rows: `sender_label` = decrypted name, `_text` = message. Advert rows: `sender_label` = node name/pubkey, `_text` = null.

## Testing

- **`feed.js` pure unit tests (Vitest):** filters to the two kinds (excludes `direct_hash`/null), drops ignored `sender_id`s (case-insensitive), sorts newest-first, respects `limit`.
- **Panel DOM** (`feedpanel.js`, `app.js` wiring, popup change): verified by `npm run build` + manual/field test — no isolated unit test (DOM glue, per AGENTS.md).

## Out of scope (YAGNI)

- Any backend/DB change (no server-side feed, no plaintext storage).
- Direct-message (`direct_hash`) rows in the feed.
- Sound/vibration/push alerts on new messages.
- Persisting feed state across reloads beyond what the existing IndexedDB snapshot already gives.

## Workflow

GitHub **issue** (feature description + acceptance) → branch **`feat/messages-feed`** off `master` → implement via subagent-driven-development (TDD per task) → open a **PR** against `master` so the flow can be reviewed/tested before merge. (Earlier iterations committed straight to `master`; this one uses the PR flow.)
