# core-hunter

Mesh-Hunter: a MeshCore **mapping and node-hunting** toolkit, live at
[mesh-hunter.eu](https://mesh-hunter.eu). Pair a companion radio to the RX webapp and every packet
it hears lands on a shared coverage map, next to what every other mapper heard. The map is also the
hunting surface: follow one node's signal to where it transmits from.

- **[rx.mesh-hunter.eu](https://rx.mesh-hunter.eu)**, the RX webapp: Web Bluetooth to a MeshCore
  companion radio; every reception is timestamped and placed with the phone's GPS. Installs as a
  PWA. Accounts are made here, from the companion you paired.
- **[map.mesh-hunter.eu](https://map.mesh-hunter.eu)**, the shared map: reads without an account
  (all-time coarse coverage and the last 24 hours of receptions). Log in to see your own receptions
  in full detail; member verification opens the full history, Locate and the CoreScope layers.

**Position disclaimer:** position is inferred from radio measurements (RSSI/SNR) via mesh topology,
not from GPS tracking of the target node. The stored coordinates are the mapping phone's own
position at the moment of reception. The map shows where you were when you heard a node and how
well, not where that node is.

## Components

| Directory | Description |
|---|---|
| [`app/`](app/) | Mobile hunter PWA: BLE scanner + live thermal hunt map. See [`app/README.md`](app/README.md). |
| [`web/`](web/) | The shared map website (map.mesh-hunter.eu): coverage, hunting, accounts, admin. |
| [`server/`](server/) | Go MQTT ingestor: subscribes to `meshcore/hunter/+/packets`, stores every reception. |
| [`nameresolver/`](nameresolver/) | Name resolver: decodes adverts into a `pubkey → name` table and serves `/api/nodes/resolve`. See [`nameresolver/README.md`](nameresolver/README.md). |
| [`landing/`](landing/) | The landing page at mesh-hunter.eu. |

Contributor guide and working rules: [`AGENTS.md`](AGENTS.md). Design specs and decision logs:
[`docs/`](docs/).

## Related projects

- [MeshCore](https://meshcore.io), the mesh networking project this toolkit is built for.
- [CoreScope](https://analyzer.on8ar.eu/#/home), the mesh observatory Mesh-Hunter builds on.
