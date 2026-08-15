# The hop count is unauthenticated — what that means for core-hunter

Spike outcome for #320. Written 2026-08-15 against MeshCore firmware
(`C:/dev/meshcore/meshcore-firmware`, authoritative per the project rule) and
`@michaelhart/meshcore-decoder` 0.3.x.

## The claim

core-hunter's whole direction-finding premise is "a zero-hop reception tells you
where a transmitter is" (AGENTS.md §1). `classifyReception` derives that from
`decoded.pathLength` (`app/src/meshpacket.js`), which comes from one plaintext
header field. **Nothing signs or MACs it.** Any node transmitting directly to the
hunter's radio can present itself as zero-hop, or fabricate a relay path.

## Verified, not assumed

**Firmware.** `Packet` (`src/Packet.h`) carries `header`, `path_len` and `path`
as plain fields; `path_len` packs hash size and count (`getPathHashSize`,
`getPathHashCount`, lines 79-83). The only hash over a packet is
`Packet::calculatePacketHash` (`src/Packet.cpp:41-50`):

```cpp
sha.update(&t, 1);                                   // payload type
if (t == PAYLOAD_TYPE_TRACE) sha.update(&path_len, sizeof(path_len));
sha.update(payload, payload_len);
```

So the digest covers the payload type and the payload — **not** the route type,
not the path bytes, and not `path_len` except for TRACE. It is also a bare
SHA-256 with no key: a dedup identifier, not an authenticity check. Anyone can
recompute it for any packet they compose.

**Decoder.** The sync `MeshCoreDecoder.decode()` core-hunter calls
(`app/src/decode.js`) performs no cryptographic checks at all. The async
`decodeWithVerification()` verifies exactly one thing
(`packet-decoder.ts:474-500`): an Advert's Ed25519 signature over
`public_key + timestamp + app_data`
(`crypto/ed25519-verifier.ts:74-110`). The header and path are outside that
message, so **even a verified Advert has an unauthenticated hop count**.

## What is actually forgeable

| Claim | Backed by | Forgeable by a direct transmitter |
|---|---|---|
| `hops = 0` (this is the origin) | nothing | yes |
| `path[last]` (which relay we heard) | nothing | yes |
| Advert pubkey / name / position | Ed25519 signature, if verified | no (but core-hunter does not verify it today) |
| Channel message contents | channel key (shared secret) | anyone holding the key |
| RSSI / SNR | our own radio | **no** |

The last row is the important one. RSSI and SNR are measured by the hunter's own
receiver and are not part of the packet, so they cannot be forged remotely — only
influenced (by transmit power, antenna, position).

## What this does *not* undermine

The rule "only zero-hop receptions locate a transmitter" is a statement about
*radio physics*, and it survives: whatever the header says, a packet that reached
our antenna directly was transmitted by something near enough to reach it. What
the header cannot tell us is **which node** that something was, or whether the
packet's origin is the node it names.

So the exposure is misattribution, not mislocation. A hunt homes in on a real
transmitter either way; the label on it is the part that can lie.

## Options considered

1. **Per-hop authentication.** Would require every relay to sign what it
   forwards, i.e. a MeshCore protocol change plus per-hop verification cost on
   battery-powered nodes. Out of core-hunter's reach — this is an upstream
   protocol property, and worth noting that MeshCore is a mesh for open
   amateur/hobby traffic, not an authenticated network.
2. **`decodeWithVerification()` for Adverts.** Does not fix the hop count, but it
   does authenticate the one packet type that carries an identity: pubkey, name
   and self-reported position. Those feed name resolution and the node-position
   layer (#272, #307) — the surfaces where a forged identity would do real
   damage. Cost is an async Ed25519 verify per Advert (3% of production traffic).
   **Recommended as a follow-up; filed as #356.**
3. **Plausibility heuristics** (a "zero-hop" reception with implausibly weak
   signal, or inconsistent with known repeater topology). That is #321's subject,
   and it is detection rather than prevention.
4. **Document and move on.** Required regardless of the above, which is what this
   note is.

## Decision

Documented as a known property of the medium, not a defect to be fixed in this
repo. AGENTS.md §1 now states it next to the zero-hop rule, so the next
implementer does not read "direct" as "authenticated". Advert verification is
worth doing on its own merits and is filed as a follow-up; per-hop
authentication is upstream's call.

## Bearing on the data already captured

None retroactively: `is_direct`/`hops` were never trustworthy in the sense this
note describes, and nothing about the stored measurements changes. The RSSI/SNR
half of every reception — the half the map and Locate actually use — was never
attacker-controlled.
