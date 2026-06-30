# core-hunter — Analysis website (iteration 1) design

> Status: **approved direction** (2026-06-30). The multi-hunter analysis site the earlier specs flagged as a
> later iteration. Builds on the deployed ingestor (`server/`, SQLite `hunter_receptions`) and reuses the
> mobile hunter's map modules. First iteration of a new subsystem; later iterations add normalization, more
> filters, and UI user-management.

## Problem / goal

Field hunters publish zero-hop receptions to one backend (`hunter_receptions`). There's no way to look at the
**combined** picture and home in on a target. The website shows **all hunters' zero-hop receptions on one map**
— as individual points and/or a hex-heatmap — **filterable by hunter, sender, and timeframe** — so an analyst
can locate a target (e.g. a public-channel spammer) from the bundled data.

State in any position-bearing output: radio (RSSI/SNR) via mesh topology, **not** GPS tracking of the target.
DB is UTC; the UI is used in local CEST (UTC+2) — the timeframe filter must make the UTC/local mapping explicit.

## Decisions (locked)

1. **Two map layers with a toggle (points / hex / both)** — like the mobile hunter map. **Points (dots) are
   the primary view** (hex alone isn't detailed enough). Both colour by RSSI tier (the hunter's thermal scale).
2. **Filters on screen:** by **hunter**, by **sender**, and a **timeframe** (from/to, date + hour).
3. **Bundled across all hunters**; **zero-hop only** (`is_direct`); **ignore-list** excluded server-side.
4. **RSSI merge = raw best-per-cell** for the hex layer (per-hunter normalization deferred).
5. **`map.on8ar.eu`, public** for now (UI user-management is a later iteration; design must not preclude auth).
6. **Extend the existing Go ingestor** with read endpoints over the same SQLite (WAL → concurrent reads safe).
7. **Reuse the mobile hunter's map** (`signal.js`, `hexgrid.js`, points/hex rendering, tile providers) adapted
   to consume API rows instead of the IndexedDB snapshot.

## Architecture

```
browser (map.on8ar.eu, public)
  └─ Leaflet map: points layer + hex layer (toggle) + filter controls
         │  debounced fetch on pan/zoom/filter-change
         ▼
nginx (94.130.105.135)  map.on8ar.eu → static frontend  +  /api/* → ingestor on meshcore-oracle
         ▼
core-hunter ingestor (Go, extended): MQTT ingest (unchanged) + read API over hunter_receptions (read-only, WAL)
         ▼
SQLite hunter_receptions (no purge)
```

- New Go package `server/internal/query` — pure aggregation + filtering over rows: `points(...)` (filtered rows
  for the dots) and `heatmap(rows, res)` (best-RSSI hex binning). Pure → unit-tested.
- Port CoreScope's pure `hexgrid.go` (Web-Mercator pointy-top binning, `res:q:r`, boundary ring) into `server/`.
- `cmd/ingestor/main.go` registers the new HTTP routes (alongside `/healthz`); the store gains read queries.
- Frontend: a new `web/` (static) — reuses the mobile app's `signal.js` + `hexgrid.js` + the points/hex Leaflet
  rendering, fed by the API. Row shape is nearly identical to the mobile record (`sender_kind/id/label, rssi,
  snr, lat, lon, rx_at, channel_name, packet_type`) plus `hunter_pubkey/hunter_name`.

## API (read-only; all gate on `is_direct=1` and exclude the ignore-list)

| endpoint | params | returns |
|---|---|---|
| `GET /api/points` | `bbox`, `from`, `to`, `hunter?`, `sender?`, `ignore?`, `limit?` | JSON array of receptions: `{lat, lon, rssi, snr, sender_id, sender_label, sender_kind, hunter_pubkey, hunter_name, channel_name, packet_type, rx_at}`; capped (default 5000) with a `truncated` flag. |
| `GET /api/heatmap` | `bbox`, `z`, `from`, `to`, `hunter?`, `sender?`, `ignore?` | GeoJSON hex `FeatureCollection`; per cell: `cell, count, best_rssi, hunters[], tier`. |
| `GET /api/hunters` | `from?`, `to?` | `[{hunter_pubkey, hunter_name, count}]` — populates the hunter filter dropdown. |

**Filter semantics:** `hunter` = exact `hunter_pubkey`; `sender` = `sender_id` prefix match (case-insensitive);
`from`/`to` = `rx_at` range (RFC3339 UTC; the frontend converts the local date+hour pickers to UTC); `bbox` =
`minLat,minLon,maxLat,maxLon`; `ignore` = comma-separated `sender_id`s excluded. `z` → hex resolution
(zoom-aware, clamped) as in CoreScope.

## Frontend (`web/`, served at map.on8ar.eu)

- Leaflet map (tile providers from CoreScope/the hunter), **points layer** (circle markers coloured by RSSI tier;
  click → popup: sender label/id, hunter name, RSSI/SNR, channel, time) + **hex layer** (best-RSSI per cell) with
  a **points/hex/both toggle** (lifted from the mobile map).
- **Filter bar:** hunter dropdown (from `/api/hunters`), sender text input (prefix), from/to datetime pickers
  (local, shown with the CEST↔UTC note). Changing a filter or panning/zooming → debounced refetch.
- Reuses `signal.js` (RSSI tiers) + `hexgrid.js` from the mobile app; no live websocket — manual/auto refresh poll.

## Testing

- **Go (pure, unit-tested):** `query.points` honours bbox/from/to/hunter/sender/ignore + zero-hop; `query.heatmap`
  best-RSSI per cell, ignore exclusion, zero-hop, limit/truncation; `hexgrid` (port CoreScope's tests).
- **HTTP handlers:** table-test the param parsing → query mapping (bad bbox/time → 400).
- **Frontend:** build + manual (map/filters/toggle are DOM glue, verified live).

## Deploy

nginx vhost on 94.130.105.135 for `map.on8ar.eu` (public): serves the static `web/` frontend and proxies
`/api/*` → the ingestor on meshcore-oracle. **Dependency:** the ingestor's API port must be **opened in the
Oracle Cloud security list** (same constraint as the app's `:3002` — an OCI-open port is required; pick an open
one or the user opens a new one). The ingestor stays one process (ingest + read API) on its existing host/volume.

## Out of scope (later iterations)

- Per-hunter relative RSSI normalization before merging.
- Channel filter, sender autocomplete/list, per-hunter detail views, sender-rotation correlation.
- Auth + **UI user-management** (public for now; architecture must not preclude adding it).
- Live updates (websocket/SSE) — this iteration polls/refetches.
- Writable server-side ignore-list management UI (ignore is a query param for now).
