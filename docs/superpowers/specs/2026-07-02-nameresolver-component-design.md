# nameresolver — SF7 name-resolver component (design)

Date: 2026-07-02
Status: approved (brainstorming), pending implementation plan

## Purpose

Provide a standalone name-resolution service for the **SF7** MeshCore network so the
hunter PWA (`app/`) and the map website (`web/`) can resolve heard pubkey prefixes to
node names on SF7, exactly as they already do for SF8 via CoreScope.

The existing SF8 resolver is CoreScope's `/api/nodes/resolve`, reached through
`corsproxy.on8ar.eu/cs/…`. There is no CoreScope instance for SF7 and the user does not
want one. `nameresolver` is a much smaller purpose-built service that produces the same
`/api/nodes/resolve` contract from a flat `pubkey → name` table it builds by listening to
SF7 observer MQTT traffic.

Non-goals: this is **not** a CoreScope. It stores no receptions, observations, hex
coverage, history, or timestamps. It is a flat node-name list plus optional coordinates.

## Scope decisions (settled during brainstorming)

- **Lives in the core-hunter repo** as a new top-level `nameresolver/` component (its own
  module, Dockerfile, and release-please entry). It only ever ships to feed this repo's
  app + website, so a separate repo would add CI/deploy/versioning overhead for nothing.
  It is kept *out* of `server/`: that module is the hunter ingestor (consumes the hunter's
  own SF8 `meshcore/hunter/#` publishes and stores full receptions); this consumes SF7
  observer topics and keeps only names. Different input, different purpose.
- **Node.js**, reusing `@michaelhart/meshcore-decoder` (v0.3.0) — the same decoder the app
  already uses and that the decoder-iteration3 spec verified against firmware. Its
  `AdvertPayload` exposes `publicKey`, `appData.name`/`hasName`, and
  `appData.location`/`hasLocation`. No CoreScope Go decoder is needed.
- **Flat list, deduped by pubkey.** One row per node. How an advert reached us (hop count,
  direction, SNR, which observer) is irrelevant and discarded. No signature gate, no
  hop filter.
- **lat/lon stored** (nullable) for a future radius lookup. The radius endpoint itself is
  deferred (YAGNI) — only the data is captured now.
- **No hardcoded secrets.** Broker URL + credentials live in a gitignored `config.json` on
  the deploy host; a committed `config.example.json` holds placeholders. Matches `app/` and
  `server/` and the AGENTS.md "no secrets in the repo" rule — the public GitHub repo never
  sees credentials.
- **Exposed via the existing `corsproxy.on8ar.eu`.** The service publishes an HTTP port on
  the Oracle host; a new `/sf7` route is added to corsproxy pointing at it. corsproxy
  already injects CORS (that is how `/cs` works cross-origin today), so the service itself
  emits no CORS headers.

## Architecture

Single small Node.js service, three internally-isolated units:

```
SF7 broker ──(MQTT, QoS 0, meshcore/+/+/packets)──► ingest ──► store (SQLite) ◄── http ──► GET /api/nodes/resolve
                                                       │                                    GET /healthz
                                                 meshcore-decoder
```

### Unit: `store` (SQLite)

- Uses Node's built-in `node:sqlite` (Node 24 on the host) — no native build step, no
  extra runtime dependency, durable and crash-safe.
- Single table:

  ```sql
  CREATE TABLE IF NOT EXISTS nodes (
    pubkey TEXT PRIMARY KEY,   -- full lowercase hex public key
    name   TEXT NOT NULL,      -- advert name (non-empty)
    lat    REAL,               -- nullable; set only when the advert carried a location
    lon    REAL                -- nullable
  );
  ```

- The `pubkey` PRIMARY KEY guarantees one row per node.
- API (the store's public interface):
  - `upsert(pubkey, name, lat, lon)` — `INSERT … ON CONFLICT(pubkey) DO UPDATE SET
    name=excluded.name, lat=excluded.lat, lon=excluded.lon`.
  - `resolvePrefix(prefix)` — `SELECT pubkey, name, lat, lon FROM nodes WHERE pubkey LIKE
    ? LIMIT 2` with pattern `prefix + '%'`. Returns up to 2 rows so the caller can tell
    unique from ambiguous.
- `pubkey` is validated lowercase hex before it reaches the store; the `LIKE` pattern is a
  bound parameter (no injection).

### Unit: `ingest` (MQTT → decode → write-gate)

- Connects to the SF7 broker from config (`mqtt` npm client, same major version family as
  the app). Subscribes at **QoS 0** to the configured topics (default
  `["meshcore/+/+/packets"]` — the narrowest filter that still carries adverts).
- Per message:
  1. Parse the JSON envelope; read the hex packet from `raw` (the field CoreScope observers
     publish; see note below on envelope confirmation).
  2. `MeshCoreDecoder.decode(rawHex)`. On decode failure → drop silently.
  3. Keep only ADVERT payloads (`getPayloadTypeName(decoded.payloadType) === 'ADVERT'`)
     that have `appData.hasName` and a non-empty `appData.name`.
  4. Extract `pubkey = decoded.publicKey` (lowercased), `name = appData.name`, and
     `lat/lon` from `appData.location` when `appData.hasLocation`, else null.
- **In-memory write-gate.** A `Map<pubkey, {name, lat, lon}>` mirrors what has been
  persisted. The store is written only when the pubkey is new, or the name changed, or the
  location changed. Repeated adverts (the same advert flooded via many observers) are
  dropped in memory → near-zero disk writes. The map is rebuilt from the DB on startup.

### Unit: `http` (resolve API)

- Minimal HTTP server (`node:http`), no framework.
- `GET /api/nodes/resolve?prefix=<hex>` — **byte-for-byte compatible with CoreScope's
  handler** so the app/web resolvers array works unchanged:
  - lowercase + trim `prefix`; reject if not `^[0-9a-f]{2,64}$` → `400`.
  - reject if shorter than **4 hex chars** (`minResolvePrefixHex`) → `400`. (Matches
    CoreScope: 1-byte keys are never stored and this blunts trivial enumeration.)
  - `store.resolvePrefix(prefix)`:
    - 0 rows → `{prefix, ambiguous:false}` (no `pubkey`/`name`).
    - exactly 1 row → `{prefix, pubkey, name, ambiguous:false}`, plus `lat`/`lon` when set
      (additive fields; the app ignores unknown keys).
    - 2 rows → `{prefix, ambiguous:true}`.
  - `Content-Type: application/json`. No CORS headers (corsproxy adds them).
- `GET /healthz` → `200 "ok"` for liveness / container health.

## Configuration

`config.json` (gitignored) on the deploy host; `config.example.json` (committed,
placeholders) documents the shape:

| Field | Required | Description |
|---|---|---|
| `mqttUrl` | yes | SF7 broker URL, e.g. `wss://…:8084/mqtt` or `mqtts://…:8883` |
| `mqttUsername` | yes | Read/subscribe account for the SF7 broker |
| `mqttPassword` | yes | Password for that account |
| `topics` | no | Topic filters to subscribe to (default `["meshcore/+/+/packets"]`) |
| `httpPort` | no | HTTP listen port (default `8090` inside the container) |
| `dbPath` | no | SQLite file path (default `/app/data/nameresolver.db`) |

## Deployment

- Docker image built from `nameresolver/Dockerfile` (Node base). Runs on the Oracle host
  (`meshcore-oracle`), published on a host port (proposed `:3004`, alongside
  `core-hunter-app:3002` and `core-hunter-ingestor:3003`), `--restart unless-stopped`,
  with the gitignored `config.json` mounted read-only and a `nameresolver-data` named
  volume for the SQLite file. Manual docker commands (per user preference), no wrapper.
- **corsproxy:** add a `/sf7` route on `corsproxy.on8ar.eu` (which runs on the web/nginx
  box, not Oracle) pointing at `oracle-host:3004`, mirroring the existing `/cs → oracle:3000`
  route. corsproxy continues to inject CORS.
- **Client wiring:** convert the app and website configs from the back-compat single
  `resolveUrl` to a `resolvers` array with both entries, e.g.:

  ```json
  "resolvers": [
    { "label": "SF8", "sf": 8, "url": "https://corsproxy.on8ar.eu/cs/api/nodes/resolve" },
    { "label": "SF7", "sf": 7, "url": "https://corsproxy.on8ar.eu/sf7/api/nodes/resolve" }
  ]
  ```

  The `resolvers` array takes precedence over `resolveUrl` in `config.js`; the existing SF8
  entry must be carried over. `orderResolvers()` moves the matching-SF resolver first when
  the companion's SF is known; all resolvers are still tried in order, first unambiguous
  hit wins.

## Testing

Vitest, matching the `app/` test conventions:

- **decode/extract:** a known ADVERT `raw` hex → correct `{pubkey, name, lat, lon}`; a
  non-advert packet → dropped; an advert without a name → dropped; an advert with a
  location → lat/lon populated; without → null.
- **write-gate:** new pubkey writes; identical repeat does not write; changed name writes;
  changed location writes.
- **store:** `resolvePrefix` returns unique / ambiguous / miss correctly; PK dedup keeps one
  row per pubkey across repeated upserts.
- **http:** resolve endpoint for hit / miss / ambiguous / non-hex / too-short (<4) prefix;
  `/healthz` returns 200.

## Open item to confirm at implementation time

The exact MQTT **envelope field** carrying the packet hex on the SF7 observer topics is
assumed to be `raw` (matches CoreScope's `client_reception.go`). Confirm against a live SF7
sample before finalizing the parser; add tolerant fallbacks (`raw` / `RAW` / `packet`) only
if a real sample requires it — do not add speculative fallbacks otherwise.
