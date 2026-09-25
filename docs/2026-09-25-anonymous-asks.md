# Auto-discover asks a selected repeater about itself (#552)

**Date:** 2026-09-25
**Status:** built as specified in #552 (which supersedes #480). `app/src/anonreq.js`, `askAnon` in `app/src/app.js`.
**Related:** #480 (the regions ask), #479 (the sweep; its anonymous half lands here), #553 and `docs/2026-09-04-companion-telemetry-probe.md` (the telemetry ask this shares the dance and the cycle with), #375 and #554 (the consumers of what is stored), efiten/coredrive-rx `src/regionreq.js`

## What it asks

A `simple_repeater` answers two anonymous requests without a login, out of one bucket of 4 answers per 180 s, and only over a direct route (`examples/simple_repeater/MyMesh.cpp`, `onAnonDataRecv`, `anon_limiter(4, 180)`):

- `ANON_REQ_TYPE_REGIONS` (0x01): its clock and the regions it forwards.
- `ANON_REQ_TYPE_OWNER` (0x02): its clock and `node_name\nowner_info`.

The third, `ANON_REQ_TYPE_BASIC` (0x03), is the clock alone, which the other two already carry, so it is not asked.

## The rules

- **Only a selected repeater, never the sweep.** The answer needs a reader, as for telemetry.
- **At most one anonymous ask per target per minute**, regions and owner in turn (`nextAnonAsk`). The bucket refills at 4 per 180 s; faster asks are refused airtime. The minute starts at the companion's ack: a request that never left the phone cost the bucket nothing.
- **One directed ask per cycle.** The companion keeps a single pending request tag and clears it on every send (`clearPendingReqs`), so a telemetry ask and an anonymous ask in one cycle would orphan a reply. When both are due they take turns (`directedAskKind`), and one flag (`state.directed.busy`) keeps a second from starting while one is out.
- **Zero-hop only.** The ask goes through the same dance as telemetry (`askAtZeroHop`): a contact with a stored path is held at zero hop and put back after, on the failure path too. A repeater that is not a contact yet is asked as it is (`askNonContact`): the companion adds it itself with a zero-hop route (`CMD_SEND_ANON_REQ`, `FIRMWARE_VER_CODE` 13+). An ack that says flood means no answer is coming, so nothing waits for one.
- **The trace-pings are unchanged.** The anonymous ask is the cycle's directed ask, beside them.
- **Autoping off, nothing transmits.** The ask is only made from the auto-discover tick.

## What is kept

Per node, beside the telemetry (`queue.putNode`): `regions`, `regions_truncated` (the list reached the 139-byte floor where a dropped name can hide), `regions_at`, `owner_name`, `owner_info`, `owner_at`, and `clock_offset_s` (the repeater's clock minus ours when it answered) with `clock_at`. The reply is matched by the tag the ack carried. Nothing renders or publishes these yet.

The reception itself, the repeater's RESPONSE datagram on the RX log, is named after the ask it answers, like a telemetry reply (`anon_reply`), and counts as a two-way repeater hearing in the reach stars (`coverage.js`), like a trace reply.

## Side effect worth knowing

The companion keeps a repeater it asked as a contact. Only selected repeaters are asked, so the contact table grows by the targets a hunter picks, not by everything heard.

## Not measured

No repeater has been asked from this app yet. The framing matches the firmware source and coredrive-rx, which runs the regions ask in the field; the owner ask and the scheduling are new here.
