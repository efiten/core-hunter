# Auto-discover pays for its airtime before the next cycle (#381)

**Date:** 2026-09-05
**Status:** decided (Kasper, 2026-09-05), implemented
**Related:** #319 and `docs/2026-08-17-speed-adaptive-autoping.md` (the spike that found this), #479 (the sweep that makes a standing cycle five frames), #577 and #578 (frames that will join the count)

## What changed

`shouldAutoFire` fires on an interval or on 50 m of movement, whichever comes first, and nothing bounded the rate from below. At 90 km/h the distance gate fires every 2 s. And the module's own budget note, "10 s alone is ~0.46% duty cycle", described one 46 ms frame, where a cycle is the Discover plus a trace-ping per target: five frames for a standing sweep.

Now a cycle is followed by a floor: the airtime it actually spent, divided by the duty budget. Neither gate fires inside it. The 10 s interval stays as the lower bound, so a hunt that fits the budget is unchanged.

## The numbers, and where they come from

All firmware facts, per AGENTS.md §7; the module header of `app/src/airtime.js` cites each.

- **Preset.** Default build flags: 869.618 MHz, BW 62.5 kHz, SF8, CR 4/5. The app reads the SF back from `PACKET_SELF_INFO` byte 56 and assumes the rest; an unknown SF reads as 8.
- **Preamble.** 32 symbols at SF ≤ 8, 16 above (`RadioLibWrappers.h`).
- **Formula.** RadioLib's `getTimeOnAir`, the function the firmware's `getEstAirtimeFor` calls, ported in the same integer arithmetic.
- **Frames.** Discover 8 bytes, trace-ping 12 (`Packet.cpp` `getRawLength`, `Mesh.cpp` `createTrace`).
- **Budget.** 869.618 MHz sits in the 869.400 to 869.650 MHz sub-band, 10% duty cycle under ERC 70-03. The 1% in the old header is the figure for a different sub-band.

| preset | Discover | trace-ping | standing sweep of 4 | floor at 10% |
|---|---|---|---|---|
| SF8 / 62.5 | 242 ms | 263 ms | 1294 ms | 12.9 s |
| SF7 / 62.5 | 121 ms | 131 ms | 645 ms | 6.5 s |

Where master stood before this: a standing sweep at SF8 was 12.9% of airtime, five targets 15.6%, and the same sweep at 90 km/h 21.6%.

## Decisions

1. **The budget is a fixed assumption, not a setting.** The app cannot read the frequency, so a setting would ask the hunter for a number the companion already knows. 10% is the default sub-band's figure and is stated in the module header.
2. **Airtime per spreading factor**, bandwidth assumed. SF7 hunters keep a shorter floor than SF8 hunters; a fixed SF8 table would have cost them half their cadence for nothing.
3. **The floor counts frames as they leave**, not as they are planned. A ping that BLE dropped spent no airtime. This is also what lets the self-advert (#577) and the telemetry request (#578) join the count by pushing their byte size, without touching the gate.
4. **The Status tab shows the cadence**: "Auto-discover: On, every 13 s". A suppressed cycle is readable, not a silent cap (AGENTS.md §5.4).

## Left out

- Reading the bandwidth or the frequency. Neither is in `PACKET_SELF_INFO`; when the firmware exposes them, the assumption in `airtime.js` becomes a reading.
- The airtime of what other nodes send back. A reply is their duty cycle, not ours.
