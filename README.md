# core-hunter

A MeshCore **node-hunting / direction-finding** tool. Drive (or walk) toward a target node using a
live **scanner** and an on-screen **map** that visualizes where you heard it and how strong — to
home in on its physical location.

Two reused building blocks:

1. **Scanner** — based on **CoreDrive RX** (`corescope-rx`): BLE to a companion radio, captures every
   direct reception (SNR/RSSI from the `0x88` RX-log frame), tags it with the phone's GPS.
   The RX tool already ships a local map (`localmap.js`) + hex grid (`hexgrid.js`) to build on.
2. **Map & point visualization** — a slice of the **CoreScope** backend: the map setup, point/marker
   layers, coverage/hex rendering and SNR/RSSI colour scaling used on the Reach/coverage page.

Goal: combine live scanning with map visualization so you can **hunt a specific node in the field**
(e.g. the recurring public-channel flooder), complementing the after-the-fact relay-triangulation
done in the `Spammer` project.

## Status

- **Phase A — Go MQTT ingestor (`server/`):** complete. Subscribes to
  `meshcore/hunter/+/packets`, validates and stores every reception with no
  purge. Unit-tested.
- **Phase B — mobile hunter PWA (`app/`):** implemented. BLE scanner,
  live thermal hunt map (thermal points + hex-heat), IndexedDB persistence,
  MQTT drain. Pending field verification with hardware and deploy of the
  ingestor. Iteration-2 changes implemented: capture/publish gated on a usable GPS
  fix rather than on naming the sender (#454), RSSI-based signal metric,
  ignore-list, and multi-resolver name resolution.

## Components

| Directory | Description |
|---|---|
| [`server/`](server/) | Go MQTT ingestor — subscribes to `meshcore/hunter/+/packets`, stores every reception |
| [`app/`](app/) | Mobile hunter PWA — BLE scanner + live thermal hunt map; see [`app/README.md`](app/README.md) |

## Related projects

- `corescope-rx` — CoreDrive RX, the mobile RX-coverage PWA → the **scanner** base.
- `CoreScope` — the analyzer/backend → the **map + point-visualization** base, plus live DB & ingestor.
- `Spammer` — public-channel flooder investigation + relay-triangulation method & report generators.
- `TDOA` — time-difference RX-fleet localization upgrade.
