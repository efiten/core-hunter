# A companion target gets a telemetry request (#553)

**Date:** 2026-09-04
**Status:** decided (Kasper, 2026-09-04), implemented
**Firmware read:** MeshCore `main` 0679dbe (2026-08-24), `companion-v1.17.1`; the table with line references is in the #553 thread
**Related:** #576 (Share my node name, the other half of the contact condition), #552 (anonymous requests, repeaters only), #481 (trace-reply attribution, the pattern this follows)

## What a companion answers

| Probe | `companion_radio` |
|---|---|
| Telemetry request (`REQ_TYPE_GET_TELEMETRY_DATA`) | Answered, from a sender it has as a contact, with battery voltage and MCU temperature |
| Directed TRACE | Forwarded only with repeat on, which is off by default |
| Anonymous requests (regions, owner, clock) | Never |
| Discover | Never; repeaters and sensors answer, so a `discover_pubkey` row is never a companion |

So a selected companion gets the telemetry request where a selected repeater gets a trace-ping. A companion transmits on its own too (adverts, messages), so it is a target either way; the probe adds a transmission on demand.

## The three conditions

1. **Our companion has the target as a contact.** Auto-add is the firmware default, so a node whose advert our companion heard is one. `CMD_SEND_TELEMETRY_REQ` answers `NOT_FOUND` otherwise, and the app skips the cycle.
2. **The target has us as a contact.** It looks the sender up by hash to find the shared secret. That is what #576's Share my node name is for; without it the ask reaches a node that cannot decrypt it.
3. **Its telemetry permission is not deny.** The firmware default is deny; the MeshCore app sets it. In the field companions answer.

## No flood

Kasper: "geen flood iig". The firmware floods a request when the contact's `out_path_len` is unknown (0xFF), and source-routes over a stored path otherwise, which may be stale. So the app runs the contact-path dance from coredrive-rx (`app/src/contactpath.js`): read the contact (`CMD_GET_CONTACT_BY_KEY`), force `out_path_len` to 0 for the ask (`CMD_ADD_UPDATE_CONTACT`, byte 35), send the request, put the contact back exactly as it was. An override that does not ack means no ask this cycle. A session that dies between the override and the restore leaves a record in localStorage, replayed on the next connect to the same companion.

The reply's route is the target's choice: direct when it knows a path to us, otherwise it floods its answer. Either way we hear it zero-hop.

## Cadence

One telemetry request per auto-ping cycle, rotating over the selected companions (`nextTelemetryTarget`). The firmware keeps one pending telemetry tag (`clearPendingReqs` on every send), so two in flight would orphan a reply. The trace-pings to repeater targets are unchanged. The sweep stays trace-only: the answer needs a reader.

## Attribution and storage

The reply on the RX log is a `RESPONSE` datagram carrying only the 1-byte source hash. Like a trace reply, it is named after the node we asked while that ask is live and unambiguous (`matchTelemetryTarget`; two live asks sharing a first byte are refused). The record gets `sender_kind: 'telemetry_reply'` and the target's full pubkey. The `PUSH_CODE_TELEMETRY_RESPONSE` (0x8B) that follows carries a 6-byte prefix and the CayenneLPP payload (voltage type 116 in 0.01 V, temperature type 103 in 0.1 °C signed); what it says goes into the new `nodes` store (IndexedDB v3, keyed by pubkey), apart from the receptions, because it describes the node rather than one hearing of it. Nothing renders it yet.

## Left out

- Path discovery (`CMD_SEND_PATH_DISCOVERY_REQ`, 52): it always floods, and the companion firmware discards the telemetry in its reply (`MyMesh.cpp:770`).
- Rendering the stored telemetry.
- Anything for a repeater target: #552.
