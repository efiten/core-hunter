# A relay id belongs to its node unless another one is in reach (#661)

**Date:** 2026-09-15
**Status:** decided (Kasper, 2026-09-14 on #661; the open questions answered 2026-09-14 and 2026-09-15). The rule is in `attribution.js`; the surfaces follow in the same bundle.
**Related:** #296 (the map's refusal this replaces), #452 (the `~` mark and `resolversFor`), #603 (the reach stars), #660 (the arrow, which needs a place to point at), #320 (a sender id is unauthenticated), `docs/2026-09-05-names-agree-or-nothing.md`, `docs/2026-09-08-coverage-overview.md`

> **Amended 2026-09-21 (#632, `docs/2026-09-21-node-glyphs-in-gl.md`).** The ● hub is a GL feature now and has no tooltip, so answer 8 and the hub paragraph under "What it costs" describe a surface that is gone. `starLabel` was removed with it. A hub is keyed by its star's id and painted in its hue.

## The problem

A flood relayed over 1-byte path hashes records its last hop as `path_hash`. No layer gave that reception a position: the reach stars took relays from 2 bytes only, the node-position layer paired only advert and Discover receptions with a registry node, and the resolver names no 2-hex id. So a reception `via #64` had nothing to draw from, and the arrow had nothing to point at.

The refusal was AGENTS.md §7: a 1-byte path hash is 1-in-256, too coarse to attribute. But a shared prefix only matters when two nodes with it are both within reach of where one was heard.

## The rule

Per reception, for a relay id of 1, 2 or 3 bytes:

1. **One candidate.** Exactly one positioned registry node whose pubkey starts with the id lies within reach of where the reception was heard. The reception belongs to that node: its advertised position, and its name with the `~` guess mark.
2. **No candidate, or no registry (a guest).** The estimate over the receptions of that id that fall under this rule themselves (answer 1), with the existing outlier rejection.
3. **Two or more candidates within reach.** Evidence of a collision: no position, no arrow, no name.

It holds for 1, 2 and 3-byte ids alike, in the app and on the map.

### Reach

The free-space distance at which a 1 W transmitter (30 dBm) with a 3 dBi antenna on both ends still arrives that strong at 868 MHz, capped at 15 km:

```
reach_km = min(15, 10 ^ ((36 - RSSI - 20 log10(868) - 32.44) / 20))
```

| RSSI | Reach |
|---|---|
| -70 dBm | 5.5 km |
| -75 dBm | 9.8 km |
| -78 dBm | 13.8 km |
| -79 dBm and weaker | 15 km |

The frequency is assumed, because the app does not read the companion's. On 433 MHz the same signal can come from twice as far, so a collision beyond 15 km goes unseen there.

### Which ids

- `relay` and `path_hash`: the last hop of a flood, at 2 or 3 bytes and at 1 byte.
- `direct_hash`: the 1-byte source hash of a zero-hop packet. It is placed and named by the rule, but it is not a reach star: zero hops is the originator, not a relay.
- Relay ids longer than 3 bytes, advert and discover keys, channel names and trace or telemetry replies keep their own rules.

## The open questions, answered

1. **Which receptions count for the estimate (rule 2).** Only the receptions that fall under rule 2 themselves. A reception placed on a node belongs to that node, and a collided one to nothing. A 1-byte id heard near node A and again where no node can be it is two transmitters; mixing A's receptions in pulls the other estimate toward A. The reach stars key a rule-1 hearing by its node's pubkey (so it joins the node's own Repeater adverts) and a rule-2 hearing by its own id (`starKey` in `coverage.js`).
2. **The name under rule 2.** A 2 or 3-byte relay id keeps the resolver's name with `~`, unless the registry holds a positioned node with that prefix out of reach. That node is evidence the name belongs to someone you did not hear here, so the id is shown instead. A node without a position is nothing reach can contradict. `attributeReception` reports it as `prefixKnown`.
3. **The target list.** A relay row shows the attribution of its newest reception, the one it already takes RSSI and age from. The row reads the attribution, not only `sender_label`, and a changed attribution repaints it (`attributionSignature`). The list sorts by the name a row shows, and the target chip takes that name too (`rememberTargetName`) and follows it on every tick when the row changes after the pick (`refreshTargetNames`), so neither names what the row refuses. The map popup's Isolate on a 1-byte hash selects every reception with that id, so the chip reads `#` and the id, never the node that one reception was placed on (`pickName`). A relay prefix merges onto an advert's row (#267) only when the name the relay row shows, without the `~`, is the advert's name (Kasper, 2026-09-15): a newest reception that collided, or that was placed on another node (even one with the same name), keeps the prefix on its own row, and one placed on the advert's own node merges under that name, with or without a resolver label.
4. **Collision candidates in the app.** The registry nodes of the resolvers on the companion's SF (`resolversFor`), or of every resolver when the SF is unknown or matches none, as #452 asks the names. A node on another SF cannot be the relay you heard. The node-position layer keeps drawing every SF.
5. **The RSSI on the map.** The app uses the plotted RSSI: `rssiCalibrationOffset` applied and the attenuator's loss added back (`effectivePlotOffset` in `signal.js`). The map receives neither, because the published RSSI stays raw (`signal.js`, `publisher.js`). So the map's reach uses the raw RSSI, and the two reaches differ by that offset, in either direction. With a positive offset (an attenuator on, or a positive calibration) the map's reach is the larger one and it can see a collision the app does not. With a negative offset (a negative calibration beyond the attenuator's loss) it is the smaller one and it can place a reception on a node the app calls a collision.
6. **The node-position layer.** It draws registry nodes only, so there the rule pairs a reception with its node (rule 1) or refuses it (rule 3). A rule-2 estimate gets no marker of its own on that layer; it shows as the reach stop's ● hub and on the arrow.
7. **Names on the map.** The map gets attribution on the node-position layer and the reach stars. Its ticker and point popup keep today's resolver names without `~`; that is a separate issue.
8. **A 1-byte id in a tooltip.** A star or hub keyed by a 1-byte id is labelled `#` plus the id on both surfaces, never a bare 2-hex name (AGENTS.md §5.4 item 6).

## Selecting a star

The reach stop's selection (`docs/2026-09-08-coverage-overview.md`, decision 6, #623 and #624) follows the same attribution:

- **What a pick selects.** A selection holds raw ids: a node's key from a tap on its ▲ or ●, and the ids picked as targets. A star is selected by its own id or by the raw id of any hearing in it (`starSelected` in `coverage.js`). A pick of the id `4a` selects the star of the node its hearings were placed on, and that node's ▲ shows selected.
- **What dims.** A dot, a pillar and, in the app, a cell dim by the star their hearing belongs to (`starKey`), not by its raw id. A hearing placed on the node of a picked id stays lit with that star. A collided hearing belongs to no star, so it steps back under any selection, a pick of its own raw id included.
- **The popup's button** reads the node's own key only. A press adds or removes that key and nothing else, so a star selected through a picked relay id offers "Show reach": "Hide reach" would promise a press that cannot undo the target pick.

## Cost in the app

The app works the rule out for every row in the window on every tick: 5.4 ms for 20 000 rows against 2 500 nodes on a laptop, 1.2 ms once each row's answer is kept while the registry index and the plot offset stay the same (`rowCache` in `rendercache.js`). While the reach stop is on, the star each record belongs to joins the map's cache keys for the dots, the pillars and the cells (`ownersKey` in `rendercache.js`): that answer moves when the registry lands or the companion's SF is set, with every record the same, so without it a cached layer kept the last tick's hue and dimming.

## On the map

- **Which registry nodes count.** The map asks the server for the registry slice of the view widened by the reach, 15 km, on every side (`padBounds` in `web/nodelayer.js`). A node just outside the view can be the one candidate for a reception inside it, or the second one that makes it a collision. The east-west pad is worked out at the box's poleward edge, where a kilometre spans the most degrees. The layer draws the nodes in view only; the rest of the slice only counts. The map has no companion, so every SF counts.
- **The RSSI** is the raw one (answer 5).
- **Who sees it.** The node-position layer and its reach stop are for members, as the registry positions are. A guest gets no layer, so the map places nothing for a guest.
- **Pairing on the layer.** The map pairs a reception with a registry node by the app's `groupSenderPointsForNodes`, pinned in `web/parity.test.js`: an advert by its whole key, a discover prefix from 2 bytes when it starts exactly one key of the padded slice, and a relay, path or direct hash by its attribution. Before, the map paired a full advert key only (#296).
- **The ● hub's tooltip** names a 2 or 3-byte id by rule 2 (`starLabel` in `coverage.js`): the resolver's name with `~`, or the id once the registry holds a node with that prefix out of reach. The padded slice cannot see a node further out, so the map also reads where the resolver places the node it names: out of the hearing's reach, the id shows. The title is part of the layer's signature, so a name or position that arrives after a draw redraws the hub. A 1-byte id reads `#` and the id (answer 8). The ticker and the point popup keep their names (answer 7).
- **Cost.** `groupSenderPointsForNodes` compared every advert and discover reception with every node passed in: 1.7 s for 25 000 synthetic receptions against 3 000 nodes, a zoomed-out padded slice. It now compares a reception only with the nodes whose key starts with the same two bytes, which is the only place a match can be: 7 ms, and 13 ms against 20 000 nodes (Node, laptop, 2026-09-15). The app runs the same function. The attribution itself takes 3 to 6 ms a pass over those 25 000 receptions, and a draw makes at most three passes (the layer, the stars, the dots), so the map keeps no memo.

## Known limits

- **433 MHz.** The reach assumes 868 MHz; see above.
- **Unpositioned registry nodes.** A node without an advertised position is dropped before the rule sees it, so a same-prefix node that never advertised a location cannot make a collision. Rule 1 then names the positioned one.
- **The outlier floor is wider than the reach.** Outlier rejection never drops a reception within 20 km of the centre (`MIN_OUTLIER_M`), and the reach stops at 15 km. A rule-2 estimate over one id heard from two unregistered transmitters 15 to 20 km apart blends them.
- **A discover prefix is refused only against the nodes compared:** the nodes in view in the app, the padded slice on the map. A prefix that also starts a node further away still pairs.
- **Beyond the slice, the map's hub sees the resolver's node only.** The resolver answers from the first registry that holds exactly one node with the prefix. When that node has no position and another registry places a node with the same prefix far away, the hub keeps `~` and the name.
- **The server cuts a slice at 20 000 nodes** and the map does not read that it did (`truncated`). A padded slice past the cap can miss a candidate.
- **The identity is still unauthenticated** (#320). A forged relay id near a registered node is placed on that node, as a forged id already moved an estimate.
