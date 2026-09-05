# A short id gets a name only when the registries agree, and wears a mark (#452)

**Date:** 2026-09-05
**Status:** decided (Kasper, 2026-09-05), implemented
**Related:** #296 (the same per-registry argument on the map's node-position layer), #136 (where relayed traffic first got a repeater name), #451 (the id beside the name in the ticker), #369 (the hash itself is forgeable; separate), `docs/2026-08-15-hop-count-trust.md`

## What changed

`resolveName` asked the configured registries in order and took the first that answered "unique". A registry's `ambiguous=false` is a claim about that registry only: a second one may know the same 2-byte prefix under another name, and it was never asked. And a 2-byte relay hash is not a node id; it is the forwarder's hash out of the path, one in 65,536 per registry. In the field (2026-08-22) hash `2beb` near Nijmegen rendered as `73s.be repeater_3_`, with nothing on screen to say it was a guess.

1. **Every registry of the companion's spreading factor is asked, at once** (`resolversFor`). A registry of another SF names nodes this radio cannot hear, so it is left out; with the SF unknown, all are asked. The order in `config.json` no longer means priority.
2. **A name only on agreement** (`consensusName`). One registry knowing the prefix, or several agreeing, is a name. Two different names for one prefix is a refusal: no name, cached as such, because no retry can turn disagreement into a name, even when a third registry was unreachable at the time. Silence with a registry unreachable is not cached, as before.
3. **A name on a 2- or 3-byte id wears `~`** (`isGuessedName`, `displayName`), on the ticker, the HUD, the target list and the map popup. It keeps the name: it is usually right and the field reads by it, and #451 puts the prefix beside it. An advert's own name on its full key, a channel sender's name and an 8-byte discover prefix are not guesses and carry no mark; a 1-byte hash never carries a name at all.

## What is deliberately still a guess

A short prefix known to exactly one registry gets that registry's name, marked. Refusing it outright (the second option in the issue) would remove the repeater names on relayed traffic, which since #136 is most of what the ticker shows. The mark and the prefix beside it are what say "check this".

## Cost

One request per registry of the SF per unknown id, instead of one per id, bounded by the session cache and the in-flight coalescing of #230. With the two registries in the example config that is at most double.

## Left out

- The map (`web/names.js`) still resolves a prefix on its own terms; the website's rule for identities is #296's and unchanged here.
- Whether the resolvers return the matched pubkey; agreement is on the name, which is what the surfaces show.
