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

**Dead — and precisely where it would have to work.** RSSI deciles:

| decile | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| `hops = 0` (n=21,537) | -117 | -114 | -111 | -108 | -102 | -94 | -74 | -64 | -48 |
| `hops > 0` (n=128,497) | -116 | -111 | -108 | -104 | -94 | -62 | -52 | -44 | -32 |

The two populations are **not** identical, and it is worth being exact about
where they differ. From decile 5 up they diverge by 8 to 32 dB, always the same
way: relayed traffic is *stronger*. That is what repeaters are — better
antennas, more power, mains supply, sited high — and it has nothing to do with
forgery.

Deciles 1-4 are the ones that matter, and there they are within 3-4 dB
(-117/-116, -114/-111, -111/-108, -108/-104). The weak tail is the only place a
"too weak to be zero-hop" threshold could live, and that is exactly the range
where the two are indistinguishable: 30% of *genuine* zero-hop receptions sit
below -111 dBm — the fringe the RSSI scale was extended for (#282/#344) — and
relayed traffic is just as weak just as often. Any such threshold flags a third
of the real fringe, which is the part of the map direction-finding needs most.

The divergence higher up does dispose of the mirror-image detector — "too
*strong* to be a claimed zero-hop" — but in the wrong direction for a defender:
a forger transmitting into our antenna from close by produces a strong
reception, which is what an honest close transmitter produces too. Strength is
evidence of proximity, never of provenance.

## Candidate 2 — cross-check the claimed path against known topology (#279)

The population first, because it is easy to measure the wrong one. A path entry
is a hash the forwarder appends: 1-3 bytes as the protocol produces it, but
`classifyReception` refuses anything under 2 bytes (`app/src/meshpacket.js`,
`last.length >= 4`), so what capture keeps is 2-3 bytes. These are the `relay`
sender kind, and they exist **only** on the `hops > 0` branch — a query filtered
to `hops = 0` contains no path hash at all, by construction.

Measured over the population that does contain them (128,497 rows, 382 ids):
312 two-byte ids, 63 three-byte, plus 19 rows carrying a 1-byte id, all inside
one two-hour window on 2026-07-22 — an anomaly against the guard rather than a
standing part of the traffic.

**Collisions are expected, not hypothetical.** Two bytes is 1 in 65,536 per
pair, but the question is how many pairs there are: with 312 distinct 2-byte
relay ids in the window, the expected number of colliding pairs is
312 × 311 / 2 / 65,536 ≈ **0.74**. About one collision in the current population,
which is the honest form of the argument — the earlier draft of this doc quoted
1 in 256, which is the *1-byte* rate, in a paragraph about 2-byte ids.

**And there is no anomaly for a topology check to find.** The widest geographic
spread of any relay id's receptions is 37 km (`4eea`, 15 rows, 3 hunters); p90 is
11 km and nothing exceeds 50 km. Every one of those is inside what a well-sited
repeater's coverage explains, so a topology cross-check has nothing to alert on
that is not also ordinary. It would need a curated prefix→relay registry
(#279's subject) to say more, and that registry is what would be doing the work,
not the check.

### The one geographic impossibility in the data is a different id class

The widest spread anywhere in the dataset is **143 km, for the 1-byte
`direct_hash` id `77`** — and every part of that sentence matters:

- `direct_hash` is `d.sourceHash` on a **zero-hop** packet, not a path entry, so
  it is not evidence about forwarder hashes at all;
- it is 1 byte (`77` is two hex characters), i.e. 1 in 256;
- that branch of `classifyReception` applies **no length guard** — the `>= 2
  bytes` refusal lives only on the FLOOD path branch, so a 1-byte id becomes a
  sender identity, a captured reception and a Locate target.

The shape of it is textbook collision: 549 of the 551 rows sit in a ~6 km area
around 51.1°N heard by three hunters, and 2 rows come from a fourth hunter
143 km away. A detector's job would be to find those two rows among 551 —
whereas a length guard on that branch drops the whole class for free. That is
#369's territory, and candidate 2's data is the best argument for it here.

## Candidate 3 — spatial coherence of one identity over time

*"An impersonator transmitting from elsewhere makes that node's receptions
bimodal."* True in principle, unusable in practice: **legitimate nodes already
move.** Measured over both identity populations, since they behave differently:

| spread per identity | zero-hop ids (327) | relay ids (382) |
|---|---|---|
| > 5 km | 47 (14%) | 68 (18%) |
| > 10 km | 12 (4%) | 44 (12%) |
| > 25 km | 1 (0.3%) | 8 (2%) |
| > 50 km | 1 (0.3%) | 0 |
| > 100 km | 1 (0.3%) | 0 |

A threshold low enough to catch an impersonator a few km away (5-10 km) fires on
14-18% of all identities. Most of the zero-hop ones are companions in cars —
mobile transmitters are the normal case for this project, not the exception —
and the relay ones are repeaters heard across their own coverage by up to ten
hunters. A threshold high enough to avoid them (>25 km) leaves 8 relay ids whose
widest spread is 37 km, all explicable as coverage, and exactly one zero-hop id:
the 1-byte `direct_hash` collision above, which is a classifier gap rather than
something to detect at runtime.

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

Three of the five are the same node with a broken clock, and its 121 copies are
most of the volume. A replay detector on this network is a stuck-clock detector,
and 11% of Adverts come from clocks like that.

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
- **The cheap buildable thing is a classifier guard, not a detector.** "No
  detector is worth building" and "there is a one-line fix in the classifier"
  are compatible conclusions, and only the first was in this spike's scope. The
  single geographic impossibility in six weeks of data is a 1-byte
  `direct_hash` id, and that branch of `classifyReception` has no length guard
  at all, while the FLOOD path branch beside it refuses anything under 2 bytes.
  See #369.
- **AGENTS.md §7's prefix rules are not what would have caught it**, and should
  not be read as such: they govern whether a short id may *merge onto a longer
  one* (`feed.js` strict, `targetpicker.js` looser per #331). They say nothing
  about a 1-byte id standing on its own row as its own identity, which is what
  `77` does — 551 rows, 4 hunters, handed to Locate as one target.

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

-- candidate 2: the path-hash population. sender_kind='relay' is the ONLY one
-- that carries a forwarder hash, and it exists only above zero hops — filtering
-- to hops = 0 (as the first draft of this doc did) excludes every one of them.
SELECT sender_id, LENGTH(sender_id)/2 AS id_bytes, hunter_pubkey, lat, lon
FROM hunter_receptions WHERE sender_kind = 'relay' AND lat IS NOT NULL;

-- candidate 3: the same, for the zero-hop identity population
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
