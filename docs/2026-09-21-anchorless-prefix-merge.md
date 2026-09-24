# The app merges a node's prefixes without an advert in the window (#625)

**Date:** 2026-09-21
**Status:** decided (Kasper, 2026-09-21). Built in `mergePrefixGroups`, `clusterKey`, `expandSelection` and `withShownIds` in `app/src/feed.js`.
**Related:** #267 (the merge), #268 (anchored, never transitive), #331 (the map's rule), #661 (attribution by reach), AGENTS.md §7 "Prefix attribution", `docs/2026-09-15-attribution-by-reach.md`

## The problem

The target list merged a prefix row onto an anchor, and an anchor was a full 64-hex pubkey. Only an advert carries one. A Discover reply carries a prefix, so a node heard through Discover replies and relay hops alone had no anchor, and every one of its ids stayed on its own row, however well the names matched. Reported on 12 September 2026: three rows for one repeater, all three checked, all three reading the same name.

Two of those rows printed the same six hex for two different ids, because a row prints the first 6 hex of its id.

## The rule

The chain rule is the map's (#331, `web/targetpicker.js`). The name gate stays the app's.

- A row attaches to the **longest** id it is a prefix of, and only when everything longer that it could be is one chain (`db11` → `db11db` → `db11db77…`). Two longer ids that are not prefixes of each other leave it on its own row. Candidates are counted by prefix alone; the name gate applies to the survivor (#268).
- **Both rows show a name and it is the same one.** The map merges unnamed rows too, because its 8-byte Discover ids carry no name. In the app a nameless relay hop attached to the one longer id in the window would feed another node's RSSI into the target, so the gate is not loosened. A collision shows no name and never merges; a relay placed on another node never merges (#661, 15 September 2026). "The anchor's node" is the node whose pubkey the anchor's id is, or is a prefix of.
- Merging starts at 2 bytes, as on the map.

## What changes besides the reported case

The old rule counted full pubkeys only as candidates. A relay `db11` next to one advert `db11aa…` and a Discover id `db11db77…` of another node attached to the advert, although it was as likely the other node's. Under the chain rule those two are not one chain, so `db11` stays alone. That is stricter than before, on purpose.

## The selection key

`clusterKey` is the longest id of the cluster. With an advert in the window that is the full pubkey, as before. Without one it used to be the row's own `sender_id`, which for a merged row is the id of whichever reception is newest, so it would have changed from one reception to the next.

The key still moves once, when a longer id is first heard (the advert arrives). `expandSelection` therefore looks a key up by cluster key first and by membership second, so a selection taken under the Discover id follows the node onto the pubkey's row.

## The printed id

A row whose 6-hex prefix is also another row's, for a different id, prints two hex more until it stands apart, up to 8 bytes (`withShownIds`). A short relay hash stays as it is and the longer id beside it grows past it. A full key is never printed, as before. It is worked out over all rows before sorting and cutting, so the pinned section and the list print one node the same way.

## Not in this change

- The map. Its rule is unchanged, and its rows are named by the longest id already. The printed-id rule is not on the map yet.
- An unnamed longest id. A chain whose longest member shows no name does not merge, even when its shorter members agree on one. The resolver names 8-byte prefixes, so this was not seen in the report.
