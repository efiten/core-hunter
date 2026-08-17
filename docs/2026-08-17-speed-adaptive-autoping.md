# Should the autoping distance gate adapt to speed?

Spike outcome for #319. Written 2026-08-17 against `app/src/autoping.js` as it
stands — `INTERVAL_MS = 10000` (line 10), `MOVE_THRESHOLD_M = 50` (11), the
`pendingTargets > 0` skip (21), the interval and distance gates (23 and 25),
`STAGGER_MS = 1500` (33) and `cycleSpanMs` (43) — and measured on the production
hunter database — 150,034 receptions from 59 hunters,
2026-06-29 → 2026-08-16. Hunter positions throughout; nothing here is a target's
position.

## The question, and the short answer

#319 asks whether the fixed 50 m gate is "too coarse" above ~30 km/h and should
shrink with speed.

**No — and the premise inverts what the gate already does.** `shouldAutoFire`
fires on *either* condition (lines 23 and 25), so the distance gate does not
delay anything at speed: it makes the cycle fire **sooner**. It is already speed-adaptive, in the
direction the issue wants. The constraint at speed is not that pings are too far
apart; it is that a fixed distance divided by a rising speed is a rising *rate*,
which the transmit budget and the cycle's own stagger both refuse to deliver.

## How much of real hunting happens up there

Speed derived from consecutive receptions of the same hunter (pairs 3-120 s
apart, ≤200 km/h; the sampling is traffic-driven, not a GPS trace, so this is the
speed *while hearing traffic* — which is the only speed autoping cares about):

| percentile | p10 | p25 | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|---|
| km/h | 0 | 0 | 0.7 | 20 | 43 | 59 | 91 |

Weighted by time: **8.3 h of 54.9 sampled hours (15%) are at ≥30 km/h**, 7% of
samples ≥50 km/h, 2% ≥80 km/h. So the regime the issue is about is real and
regular — a sixth of the time — but it is not where most hunting happens. Worth
answering properly; not worth rushing.

## What the current gate does at speed

`min(10 s, 50 m / v)` — the distance gate becomes the binding one above
**18 km/h** and dominates from there. A cycle is not one frame, though: it is the
discover broadcast **plus one trace-ping per selected target**, so the airtime
per cycle is `(N + 1) × 46 ms`, and the period is `max(50 m / v, N × 1.5 s)`
because of the stagger (below). Duty for the whole cycle:

| speed | period (N=0) | N=0 | N=1 | N=3 | N=5 |
|---|---|---|---|---|---|
| stationary (interval-bound) | 10 s | 0.46% | 0.92% | **1.84%** | **2.76%** |
| 20 km/h | 9.0 s | 0.51% | **1.02%** | **2.04%** | **3.07%** |
| 30 km/h | 6.0 s | 0.77% | **1.53%** | **3.07%** | **3.68%** |
| 40 km/h | 4.5 s | **1.02%** | **2.04%** | **4.09%** | **3.68%** |
| 50 km/h | 3.6 s | **1.28%** | **2.56%** | **4.09%** | **3.68%** |
| 90 km/h | 2.0 s | **2.30%** | **4.60%** | **4.09%** | **3.68%** |
| 120 km/h | 1.5 s | **3.07%** | **6.13%** | **4.09%** | **3.68%** |

(Bold is over the 1% the module assumes. The N=3 and N=5 columns stop rising
because the stagger floor takes over — above 40 km/h for three targets and above
24 km/h for five, the cycle cannot repeat faster than it can be sent, so speed
stops mattering and only the target count does. Every cell is
`(N + 1) × 46 ms / max(50 m / v, N × 1.5 s)`, computed rather than typed.)

The 46 ms figure and the 1% comparison are `autoping.js`'s own stated budget —
"10 s alone is ~0.46% duty cycle … comfortable headroom below a 1% sub-band".
Two things follow, and the first is not what the issue is about:

1. **The budget is exhausted by target count before it is exhausted by speed.**
   A five-target hunt sits at ~2.8% while **parked**, nearly 3× the figure the
   module claims headroom under. The zero-target sweep — the only configuration
   the "headroom is gone at ~40 km/h" reading describes — is the *best* case.
2. **Lowering the threshold moves every one of those numbers the wrong way.** At
   a 25 m gate the 30 km/h row goes to ~1.53% for a bare discover, so the halved
   threshold is over the module's budget from about **20 km/h**, not from 40.

Which sub-band actually applies depends on the configured frequency, which is a
firmware/config fact the app does not read (§7), so this is stated against the
module's own assumption rather than as a regulatory claim — but the direction is
unambiguous.

## Where a smaller threshold would have no effect at all

`shouldAutoFire` returns false while `pendingTargets > 0`, and a cycle of N
selected targets occupies `N × 1500 ms` of staggered trace-pings. So the achieved
period is `max(50 m / v, N × 1.5 s)` — the guard, not the threshold, is what
floors the cadence as soon as one target is selected:

| targets | cycle span | achieved spacing at 90 km/h | binding constraint |
|---|---|---|---|
| 0 | — | 50 m | distance gate |
| 1 | 1.5 s | 50 m | distance gate (just) |
| 3 | 4.5 s | 112 m | stagger |
| 5 | 7.5 s | 187 m | stagger |

A multi-target hunt at speed already samples every 100-190 m, and no threshold
below 50 m changes that by a metre. Worth noting the stagger's double role, since
it appears twice in this doc with opposite signs: here it is the reason the
proposed change would do nothing, and in the duty table above it is also the only
thing keeping a multi-target cycle from being far worse than it already is. The only case a smaller threshold would
actually speed up is the zero-target discover-only sweep — the one case that
sends a single frame per cycle and therefore has the *most* budget to lose from
firing more often. The change would land exactly where it is least wanted.

## What actually limits sample placement at speed

Two effects, both larger than the spacing being argued over:

1. **The stored position is the position at BLE hand-off, not at reception.**
   `buildRecord` stamps `rx_at` and the GPS fix when the frame is handled
   (`app/src/capture.js`), and the companion's RX log can deliver a backlog: the
   #321 measurements found batches of 14 to 56 packets stamped 2-40 ms apart,
   i.e. packets received seconds or minutes apart, all tagged with one position.
   At 90 km/h, a 5 s hand-off delay places a reception 125 m from where it was
   heard — more than the entire spacing this issue proposes to buy back.
2. **The round trip costs more ground than the interval saves.** An autoping is
   worth firing because the *response* is a fresh measurement at our position.
   The response cannot arrive sooner than one airtime plus the target's
   turnaround, and at 90 km/h the hunter covers 25 m per second of that. Pinging
   every 25 m instead of 50 m does not produce samples 25 m apart; it produces
   the same samples with a smaller number written on the gate. (The turnaround is
   not measured here — the hunter's own transmissions are not in the database —
   so this is a bound, not a figure.)

## Decision

**Leave `MOVE_THRESHOLD_M` at 50 m, and do not make it speed-dependent.** The
gate is already speed-adaptive by construction; making it more so spends transmit
budget that the module's own duty-cycle note says is already spent at 40 km/h,
and for a multi-target hunt it would not change the sampling at all.

Two things this spike found that are worth their own issues if anyone wants to
act on them — both are the *opposite* change, and neither is in #319's scope:

- **A minimum period between cycles** (a duty-cycle floor). Not a hypothetical:
  by the module's own figures the design is already over its stated budget in
  ordinary multi-target use **standing still** (1.8% at three targets, 2.8% at
  five), and the distance gate then compounds it with speed. This is the
  measured constraint the current design leaves unbounded, and it is the one
  place a change would actually buy something.
- **A position for the reception rather than for the hand-off** — carrying the
  fix forward per frame is not possible (the RX-log frame has no timestamp), but
  a backlog drain could at least be *marked*, so a batch of receptions sharing
  one position is visible as such rather than read as 56 measurements at one
  spot.

Revisit #319 itself only if the interval ever becomes the binding gate again at
speed — i.e. if the threshold is raised well above 50 m, or the stagger is
removed.

## Reproducing the measurement

Read-only, against the ingestor's SQLite database:

```sql
SELECT hunter_pubkey, rx_at, lat, lon FROM hunter_receptions
WHERE lat IS NOT NULL ORDER BY hunter_pubkey, rx_at;
```

Speed is the haversine distance between consecutive receptions of one hunter
divided by their time gap, keeping pairs 3-120 s apart and discarding anything
above 200 km/h; the time-weighted share uses the same gaps as weights. Pairs
closer than 3 s are dropped precisely because of the backlog-drain effect
described above — they are not samples of movement.
