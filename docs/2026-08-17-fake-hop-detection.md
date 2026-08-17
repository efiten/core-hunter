# Can we detect a node faking its hop count?

Spike outcome for #321, the detection half of #320
(`docs/2026-08-15-hop-count-trust.md`, which establishes *that* the hop count is
forgeable). Written 2026-08-17. Every number below is measured on the production
hunter database — 150,034 receptions from 59 hunters, 2026-06-29 → 2026-08-16 —
and on the 4,000 most recent Advert captures in it (2026-07-02 → 2026-08-15),
re-decoded with the app's own decoder. Positions throughout are hunter positions:
we map radio measurements via mesh topology, never GPS tracking of a target.

## The ceiling on any detector

A forged hop count does not change the physics, and that bounds what any
heuristic can see.

Whatever the header claims, the packet was **transmitted by whoever transmitted
it**, and RSSI/SNR describe exactly that transmitter — its power, antenna,
distance and obstruction. A relay forwarding a packet and an origin sending one
are the same physical event to our radio. So there is no "expected signal for a
zero-hop reception" to compare against: the honest model of a zero-hop RSSI is
*the same model* as for a relayed one.

That leaves only consistency tests — does this claim contradict other claims, or
the same node's own history? Every candidate below is one of those, and each is
measured against what real traffic already does.

## Candidate 1 — implausibly weak signal for a claimed zero-hop

**Dead.** The two populations are the same distribution. RSSI deciles:

| decile | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| `hops = 0` (n=21,537) | -117 | -114 | -111 | -108 | -102 | -94 | -74 | -64 | -48 |
| `hops > 0` (n=128,497) | -116 | -111 | -108 | -104 | -94 | -62 | -52 | -44 | -32 |

30% of *genuine* zero-hop receptions sit below -111 dBm — the fringe the RSSI
scale was extended for (#282/#344) — and relayed traffic is just as weak just as
often. Any threshold that flags "too weak to be zero-hop" flags a third of the
real fringe, which is the part of the map direction-finding needs most.

## Candidate 2 — cross-check the claimed path against known topology (#279)

**Dead for detection, and it is our own data that shows why.** A path entry is a
2-3 byte hash appended by the forwarder, so it collides by accident: 1 in 256 for
the 2-byte case. Taking the widest geographic spread of any identity's zero-hop
receptions, the single largest in the whole dataset is **143 km, for the 2-byte
`direct_hash` id `77`** (551 rows, 4 hunters). That is not an attacker; that is
one prefix standing for several nodes — precisely the ambiguity AGENTS.md §7
already refuses to treat as an identity. A topology cross-check would spend its
alerts on prefix collisions.

## Candidate 3 — spatial coherence of one identity over time

*"An impersonator transmitting from elsewhere makes that node's zero-hop
receptions bimodal."* True in principle, unusable in practice: **legitimate nodes
already move.**

| zero-hop spread per identity | senders (of 327) |
|---|---|
| > 5 km | 47 (14%) |
| > 10 km | 12 (4%) |
| > 25 km | 1 (0.3%) |
| > 100 km | 1 (0.3%) |

A threshold low enough to catch an impersonator a few km away (5-10 km) fires on
14% of all senders, most of them companions in cars — mobile transmitters are the
normal case for this project, not the exception. A threshold high enough to avoid
them (>25 km) has exactly one hit in six weeks, and that hit is candidate 2's
prefix collision.

## Candidate 4 — half-duplex simultaneity

*"One radio cannot transmit two different packets at once, so two overlapping
transmissions under one identity prove a second transmitter."* Sound physics,
**unobservable with what we record.**

- Within one hunter it can never fire: BLE `0x88` frames arrive serially by
  construction, so two receptions are never simultaneous no matter what happened
  on air.
- Across hunters it needs sub-airtime resolution (LoRa airtime here is on the
  order of 100 ms), but `rx_at` is the **phone's own clock** at frame receipt —
  independent, unsynchronised, and with the BLE hand-off in between.
- And `rx_at` is not the air time at all. 41 of 5,066 same-hunter one-second
  buckets hold more than one distinct packet, and reading them settles the
  question: they are batches of 14 to 56 packets stamped 2-40 ms apart — a
  backlog draining out of the companion's RX log at once, of packets that were
  received on air seconds or minutes apart. The timestamp we store is when the
  frame crossed BLE.

So the one detector with sound physics behind it needs a shared time base we do
not have, over a timestamp that does not mean what it would have to mean.

## Candidate 5 — Advert freshness window

Adverts are the one signed thing in the protocol (#362 now verifies the
signature), and they carry a signed timestamp. So: reject an Advert whose
timestamp is far from now, which would blunt replay.

**The clocks are not good enough.** Over 3,999 decoded Adverts from 308 nodes:

| \|rx_at − signed timestamp\| | share |
|---|---|
| ≤ 60 s | 53.0% |
| ≤ 1 h | 72.7% |
| ≤ 1 day | 86.1% |
| ≤ 30 days | 88.4% |

453 Adverts (11.3%) carry a timestamp from **before 2026** — an unset clock — and
90 are more than a day in the future. Per node it is worse than per packet:
**120 of 308 nodes (39%) have a median offset over an hour**, so a freshness gate
does not drop occasional packets, it drops two fifths of the network permanently.
A window wide enough to keep them (days) is wider than any replay needs.

## Candidate 6 — repeated Advert signature (replay)

The most promising on paper: identical signed bytes seen twice cannot both be
fresh. And the bulk statistics look encouraging — of 433 distinct signatures, 333
recurred, but **328 of those recurrences are within 60 s** (p90 span 4 s), which
is just the flood: one advert, relayed, heard several times.

Then the five wider cases show what the alert list would actually contain:

- 96 copies of one signature over **3.4 days**, zero-hop, two hunters — from a
  node whose signed timestamp is `1970-01-01T00:00:02`. Its clock never advances,
  so every advert it emits is byte-identical, forever.
- 16 more copies of the same node's signature over 1.9 h, and 9 copies of another
  of its adverts (signed `2024-05-15`) over 230 s.
- 40 copies of one repeater's advert over 47 min at 8 hops.
- one 296 s pair at 10 hops.

Four of the five are one broken clock. A replay detector on this network is a
stuck-clock detector, and 11% of Adverts come from clocks like that.

## Decision

**No detection mechanism is worth building today.** Every candidate either has no
discriminating power (1, 2), is dominated by legitimate behaviour (3, 5, 6), or
needs data we cannot record (4). They fail for one shared reason: the metadata a
consistency test would have to lean on — path hashes, node clocks, self-reported
positions — is itself noisy enough that the anomalies are already there in
honest traffic.

What remains, and is already done or already stated:

- **#362 (Advert signature verification) is the real lever**, and it is merged.
  It removes identity *invention*: a name and pubkey now have to belong to a node
  that really signed them. It does not stop replay — and this spike is why we are
  not going to catch replay by heuristic either.
- **AGENTS.md §1 and `docs/2026-08-15-hop-count-trust.md` already say the honest
  thing**: anonymous coverage is sound, every *"node N was here"* claim rests on
  an unauthenticated identity. That statement is the mitigation.
- **AGENTS.md §7's prefix rules do more against this than any detector would.**
  Candidates 2 and 3 both terminated on a 2-byte id standing for several nodes;
  refusing short prefixes as identities is what keeps that out of Locate.

Worth revisiting only if the inputs change: a shared time base across hunters
(candidate 4 becomes observable), MeshCore adding per-hop authentication or
receiver binding in Adverts (candidates 5 and 6 become sound), or a real incident
to calibrate against — right now there is no known forgery in the data, so every
threshold above is fitted to noise, not to an attack.

## Reproducing the measurements

Read-only, against the ingestor's SQLite database:

```sql
-- candidate 1: RSSI by claimed hop count
SELECT rssi FROM hunter_receptions WHERE hops = 0  AND rssi IS NOT NULL ORDER BY rssi;
SELECT rssi FROM hunter_receptions WHERE hops > 0  AND rssi IS NOT NULL ORDER BY rssi;

-- candidates 2 and 3: zero-hop geographic spread per identity
SELECT sender_id, sender_kind, hunter_pubkey, rx_at, lat, lon, raw
FROM hunter_receptions WHERE hops = 0 AND sender_id <> '' AND lat IS NOT NULL;

-- candidates 5 and 6: Adverts, re-decoded for timestamp and signature
SELECT rx_at, raw, hops, sender_id, hunter_pubkey
FROM hunter_receptions WHERE packet_type IN ('Advert', 'advert') ORDER BY rx_at DESC LIMIT 4000;
```

Spread is the bounding-box diagonal (haversine) of one identity's zero-hop
reception points. The Advert timestamp and signature come from
`MeshCoreDecoder.decode(raw).payload.decoded` — the same decoder `app/src/decode.js`
uses, so the figures describe what the app itself would see.
