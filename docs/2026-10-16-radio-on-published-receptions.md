# Published receptions carry the radio settings (#744)

**Date:** 2026-10-16
**Status:** decided, implemented
**Related:** #650 (the companion reports its radio in SELF_INFO), #454 (rows are stamped at
capture), #554 (the wardrive format), #609 (the duty floor reads the reported radio)

## The problem

No published message said which network a reception was heard on. meshcore-analyzer.eu places
Mesh-Hunter receptions on its coverage map, and coverage only means something per network: a cell
heard on 869.618 MHz / 62.5 kHz / SF8 says nothing about another preset. The analyzer guessed the
network from fixed observers that heard the same packet, and a packet no fixed observer heard
stayed without one.

## What changed

Every published reception (`packets`, `wardriver/obs` and `wardriver/track`) carries the radio
string every MeshCore MQTT observer already sends on `status`, in the same format:

    "radio": "869.618,62.5,8,5"

Frequency in MHz, bandwidth in kHz, SF, CR. Consumers that do not know the field ignore it.

## Decisions, and why

- **Stamped at capture, not at publish.** Same argument as `rx_pubkey` (#454): a backlog can be
  published hours later, under another preset or another companion, and the network a reception
  was heard on does not change with them. `buildRecord` and the track row carry the string; the
  publisher sends what is on the row (`radioString` in `selfinfo.js`).
- **All four values or nothing.** The status format has four fixed positions, so a gap would shift
  the meaning of the rest. A companion that does not report the full radio (older firmware, §7:
  unknown is null, never guessed) publishes without the field.
- **No migration.** Rows stored before the stamp existed publish without the field, exactly like a
  consumer that never knew it.
- **The track carries it too.** `rx_count: 0` with `listening: true` is silence evidence, and
  silence only counts per network.
