# core-hunter PWA — mobile hunter app

A progressive web app that scans a MeshCore mesh via BLE and plots every
directly-heard reception on a live thermal map so you can drive or walk
toward a target node.

## What it is

core-hunter is the mobile **hunter** side of the core-hunter system. The
phone pairs over BLE to a companion MeshCore radio, captures every packet
the radio hears directly (zero-hop, with SNR, RSSI, and the phone's own GPS
fix), and renders them as a heat-map where **hot = strong = close**. Drive
toward the heat to home in on the target.

Receptions are stored locally in IndexedDB and published to an MQTT broker
so the server-side Go ingestor (`server/`) can aggregate observations from
multiple hunters in the field.

## Status

Phase A + B built; iteration-2 capture/visualization changes implemented
(zero-hop only, RSSI metric, ignore-list, multi-resolver). Pending field
verification with hardware and deploy of the ingestor.

## Build and run

```
npm install
```

**Dev server** (Vite — serves on `http://localhost:5173` by default):

```
npm run dev
```

Web Bluetooth and Geolocation both require a [secure context][secure]. The
dev server on `localhost` qualifies; any other host must be served over
HTTPS.

**Production build / preview:**

```
npm run build     # output in dist/
npm run preview   # serve the dist/ build locally
```

**Unit tests** (Vitest, no browser required):

```
npm run test
# or: npx vitest run
```

[secure]: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts

## Configuration

Copy the example config and fill in your broker details before running:

```
cp public/config.example.json public/config.json
```

`public/config.json` fields:

| Field | Required | Description |
|---|---|---|
| `mqttUrl` | yes | WSS URL of your EMQX broker, e.g. `wss://broker.example.com:8084/mqtt` |
| `mqttUsername` | yes | Publish-only EMQX account username |
| `mqttPassword` | yes | Publish-only EMQX account password |
| `resolvers` | no | Array of `{ label, sf, url }` regional CoreScope name-resolver endpoints (back-compat: a single `resolveUrl` string also works) |
| `rssiCalibrationOffset` | no | dBm offset added to every raw RSSI before band assignment (default: 0) |

`config.json` is gitignored; never commit credentials.

### Broker ACL (required)

`config.json` is served next to `index.html`, so **every visitor to the PWA can
read `mqttUsername`/`mqttPassword`** — this is unavoidable for a browser-based MQTT
publisher. The credentials are safe to expose *only* if the broker account is locked
down so a leaked credential can do nothing but publish receptions. Do not point the PWA
at a broker where this account can subscribe or publish freely.

Configure the EMQX account (`hunter-pub` in the examples) with exactly these two
authorization rules, in order:

| # | Permission | Action | Topic | Effect |
|---|---|---|---|---|
| 1 | allow | publish | `meshcore/hunter/${clientid}/packets` | publish receptions only |
| 2 | deny | all | `#` | block everything else |

Rule 2 is the catch-all: with it in place the account cannot subscribe to any topic
(no reading other clients' feeds) and cannot publish anywhere but its own packets
topic — even if EMQX's global `no_match` default is `allow`. If you run additional
broker accounts, set the broker-wide authorization default to `deny` as well.

Residual risk that no ACL can remove: because the MQTT client id is chosen by the
connecting client, anyone with the credentials can still publish fabricated receptions
(fake GPS/SNR) under any client id. That can pollute the map's data but grants no read
access and no other capability. Add server-side plausibility checks if that matters.

## The capture rule

- **`is_direct = (hops === 0)`.** Only zero-hop receptions — where the radio
  heard the transmitter directly — point at where that transmitter actually is.
  A relayed packet's SNR/RSSI describes the *last repeater*, not the target.
  Relayed traffic (hops > 0) is dropped: not logged, not published, not plotted.
- **Unattributed 0-hop packets are plotted.** A companion that never advertises
  has no pubkey on its data packets (`sender_key = null`); it is still plotted by
  signal, which is exactly how you find it. Zero-hop senders are either a full
  advert/discover pubkey or `null`.
- **Published to MQTT** on `meshcore/hunter/{rxPubkey}/packets` (QoS 1).
  Everything captured (all zero-hop receptions) is published. UI filters
  affect only the **local map view**, not what is published; the backend
  deduplicates.

## Thermal map semantics

The colour ramp runs **cold (blue) → hot (red)** for **weak (far) →
strong (close)**. Colour and heat are driven by **RSSI** using fixed dBm bands:

| Band | Range | Colour |
|---|---|---|
| Hot | >= -80 dBm | red |
| Warm | -80 to -90 dBm | orange |
| Mid | -90 to -100 dBm | yellow |
| Cool | -100 to -110 dBm | cyan |
| Cold | < -110 dBm | blue |

An optional `rssiCalibrationOffset` (dBm) in config shifts every raw RSSI
value before band assignment. SNR is still stored and shown as a number.

All plotted points are zero-hop (no direct/relayed distinction). Two map
layers are available: individual **signal points** and a **hex-heat**
aggregate layer. Toggle between them with the layer button in the map controls.

## Ignore-list

Known stations (e.g. repeaters) that should not form false hotspots can be
muted via the **ignore-list**. Open the popup for a point and press
"Ignore this ID" to add it. Ignored stations are hidden from the map but
their receptions are still stored and published. The list is managed in the
settings sheet and persisted in localStorage.

## Name resolution

Resolvers in `config.json` are tried in config order; the first unambiguous
hit wins. Providing multiple resolvers (e.g. one per region/spreading-factor)
allows coverage across different network segments. SF-ordered resolver
preference is firmware-gated (the companion's SF is not yet readable) and
falls back to config order. The resolver region label is not shown next to
the resolved name.

## Resilience

Receptions are written to IndexedDB before any MQTT publish attempt. The map
renders from that local store on every tick. If BLE drops, MQTT drops, or
the browser is closed and reopened, the map reloads from the stored data.

The MQTT drain loop publishes rows to the broker but **never deletes local
rows**. The local IndexedDB is the working set; the backend deduplicates by
`(origin_id, rx_at, sender_key)`.

## sender_role

`sender_role` is plumbed end-to-end through the capture record, the MQTT
payload, and the ingestor schema, but it is always `null` in the current
build. Advert-role decoding is deferred until the byte layout can be
confirmed from MeshCore firmware source. The field will never contain a
guessed value.

## Position disclaimer

Position is inferred from **radio measurements** (RSSI, SNR) via
direct reception, not from GPS tracking of the target node. The GPS coordinates
stored with each reception are the **hunter phone's own position** at the
moment of reception. The map shows where *you* were when you heard the
target, and how well — not where the target is.
