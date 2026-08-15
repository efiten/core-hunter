# The hop count is unauthenticated — what that means for core-hunter

Spike outcome for #320. Written 2026-08-15 against MeshCore firmware
(`C:/dev/meshcore/meshcore-firmware`, authoritative per the project rule) and
`@michaelhart/meshcore-decoder` 0.3.x.

## The claim

core-hunter's direction-finding premise is "a zero-hop reception tells you where
a transmitter is" (AGENTS.md §1). `classifyReception` derives that from
`decoded.pathLength` (`app/src/meshpacket.js`), which comes from one plaintext
header field. **Nothing signs or MACs it.** Any node transmitting directly to the
hunter's radio can present itself as zero-hop, or fabricate a relay path.

## What the protocol does and does not authenticate

MeshCore is not uncryptographic — it just protects payloads, never routing.

| Mechanism | Covers | Firmware |
|---|---|---|
| `Packet::calculatePacketHash` | payload type + payload (+ `path_len` for TRACE only). Keyless SHA-256, a dedup id anyone can recompute | `Packet.cpp:41-50` |
| `encryptThenMAC` / `MACThenDecrypt` | HMAC-SHA256 over the *ciphertext* under a shared secret, truncated to `CIPHER_MAC_SIZE` | `Utils.cpp:135-158`, applied `Mesh.cpp:480,505,533,553`, checked `Mesh.cpp:158,215,242` |
| Channel MAC (decoder side) | first 2 bytes of HMAC-SHA256 over the ciphertext under the channel secret | `crypto/channel-crypto.ts:28-34` |
| Advert Ed25519 signature | `public_key + timestamp + app_data` | `crypto/ed25519-verifier.ts:74-110` |

**None of them cover the header, the route type or the path bytes.** That is the
whole finding: every authentication in the system is payload-scoped, so the
routing metadata core-hunter's capture rule reads is unprotected by construction.

Two corollaries worth stating, because both are easy to get wrong:

- The sync `MeshCoreDecoder.decode()` core-hunter calls is **not** check-free:
  `app/src/decode.js` passes a keyStore, so a decrypted channel message did pass
  a 2-byte MAC under the channel key. That proves possession of a shared secret
  (every channel member holds it), not identity.
- `decodeWithVerification()` (`packet-decoder.ts:33`, verification block in
  `parseInternalAsync` around `packet-decoder.ts:474-500`) verifies only the
  Advert signature, so **even a verified Advert has an unauthenticated hop
  count**. Its `try/catch` swallows verification errors into `console.error`
  without touching `isValid`, so it does not fail closed.

## What is actually forgeable

| Claim | Backed by | Forgeable by a direct transmitter |
|---|---|---|
| `hops = 0` (this is the origin) | nothing | yes |
| `path[last]` (which relay we heard) | nothing | yes — and it is a 2-3 byte hash, so it collides by accident too |
| Advert pubkey + name | Ed25519 signature, if verified | fabrication no; **replay yes** (no receiver binding, no freshness check, no dedup at capture) |
| Advert self-position | the same signature | the signature proves the key holder *said* it, never that it is true |
| Channel message contents | 2-byte MAC under the channel key | anyone holding the key |
| RSSI / SNR of a reception | our own radio | no — measured by the receiver, not carried in the packet |

## What this costs us — precisely

The anonymous claim survives: whatever the header says, a packet that reached our
antenna was transmitted by something near enough to reach it. RSSI and SNR are
ours and cannot be forged remotely, only influenced (power, antenna, position).

**But every per-node claim inherits the forged identity, including position.**
`locate()` runs over an already sender-filtered record set
(`app/src/locate.js`), so an attacker at X transmitting packets that carry node
N's identity puts rows with `sender_id = N` into the set, and the RSSI-weighted
centroid for N is dragged toward X. Same for the node-position layer's drift
figure, and for any hex cell attributed to N.

So the honest statement is **not** "misattribution, not mislocation". It is:

> The map's anonymous coverage is sound. Every claim of the form *"node N was
> here"* — Locate, drift, per-sender coverage — is only as good as an identity
> the protocol does not authenticate.

## The implemented rule is broader than "zero-hop"

`classifyReception` captures a FLOOD packet's `path[last]` at `hops > 0` as
`heardDirect`, not just `hops === 0`. That branch is *also* a real
measurement — the last forwarder did transmit to us — but its id is a 2-3 byte
path hash appended by that forwarder: forgeable like everything else in the path,
and collision-prone even without an attacker (which is why `meshpacket.js`
refuses 1-byte hashes). Anything reasoning about "the zero-hop rule" needs to
account for that second branch.

## Options considered

1. **Per-hop authentication.** Every relay would have to sign what it forwards:
   a MeshCore protocol change plus per-hop verification cost on battery-powered
   nodes. Out of core-hunter's reach, and worth remembering that MeshCore is a
   mesh for open amateur traffic, not an authenticated network.
2. **`decodeWithVerification()` for Adverts (#356).** Does not fix the hop count,
   and does not stop **replay** — the signature has no receiver binding or
   freshness check and capture does no dedup, so a captured Advert replayed from
   elsewhere verifies and poisons `locate(N)` exactly as a fabricated one would.
   What it does buy is that an identity cannot be *invented*: a name and pubkey
   have to belong to a real node that really signed them. That is worth having
   for the surfaces that render identity (name resolution, the node-position
   layer), and it is the only cryptographic lever this repo actually has.
   Recommended, with those limits stated.
3. **Plausibility heuristics** — a "zero-hop" reception with implausibly weak
   signal, or one inconsistent with known repeater topology. #321's subject;
   detection rather than prevention, and the only approach that can touch replay.
4. **Document and move on.** Required regardless of the above, which is what this
   note is.

## Decision

Documented as a property of the medium, not a defect this repo can fix. AGENTS.md
§1 states it next to the zero-hop rule so "direct" is not read as
"authenticated", and names the per-node consequence rather than reassuring the
reader. Advert verification is filed as #356 with its limits written down;
per-hop authentication is upstream's call.

## Bearing on the data already captured

Nothing about the stored measurements changes, and no reprocessing follows from
this: `hops`/`is_direct` were never more trustworthy than they are now. The
reassurance that does **not** hold is "only the labels could be wrong" — a
sustained forged-identity transmitter would have moved that node's Locate
centroid in the stored data too, and there is no way to detect that after the
fact from what we keep. Nothing in production suggests it happened; the point is
that the data cannot rule it out.
