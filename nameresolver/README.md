# nameresolver — SF7 name resolver

Standalone service that listens to SF7 observer MQTT traffic, decodes adverts
into a flat `pubkey → name (+lat/lon)` SQLite table, and serves a
CoreScope-compatible `GET /api/nodes/resolve` for the hunter app and website.

See the design spec: `docs/superpowers/specs/2026-07-02-nameresolver-component-design.md`.

## Configure

```
cp config.example.json config.json   # then fill in the SF7 broker creds
```

`config.json` is gitignored — never commit credentials.

| Field | Required | Description |
|---|---|---|
| `mqttUrl` | yes | SF7 broker URL (`wss://…/mqtt` or `mqtts://…`) |
| `mqttUsername` | yes | Read/subscribe account |
| `mqttPassword` | yes | Password |
| `topics` | no | Subscribe filters (default `["meshcore/+/+/packets"]`) |
| `httpPort` | no | HTTP port (default `8090`) |
| `dbPath` | no | SQLite file (default `/app/data/nameresolver.db`) |

## Run (Docker, on the Oracle host)

```bash
docker build -t nameresolver .
docker stop nameresolver 2>/dev/null; docker rm nameresolver 2>/dev/null
docker run -d --name nameresolver --restart unless-stopped -p 3004:8090 \
  -v "$(pwd)/config.json:/app/config.json:ro" \
  -v nameresolver-data:/app/data nameresolver
```

Health: `curl http://127.0.0.1:3004/healthz` → `ok`.

## Expose via corsproxy

Add a `/sf7` route on `corsproxy.on8ar.eu` (runs on the web/nginx box) pointing
at `oracle-host:3004`, mirroring the existing `/cs → oracle:3000` route.
corsproxy injects CORS, so this service emits none.

## Wire the clients

Set the `resolvers` array in the app and website `config.json` (the array takes
precedence over the legacy single `resolveUrl`, so include the SF8 entry too):

```json
"resolvers": [
  { "label": "SF8", "sf": 8, "url": "https://corsproxy.on8ar.eu/cs/api/nodes/resolve" },
  { "label": "SF7", "sf": 7, "url": "https://corsproxy.on8ar.eu/sf7/api/nodes/resolve" }
]
```

## Endpoint

`GET /api/nodes/resolve?prefix=<hex>` (min 4 hex chars) →
`{prefix, pubkey?, name?, ambiguous, lat?, lon?}`.
