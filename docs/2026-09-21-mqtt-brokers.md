# Several MQTT brokers, and a page to manage them (#554)

**Date:** 2026-09-21
**Status:** decided (Kasper, 18 and 21 September 2026, on the approved artboard), implemented; not yet run against a real companion or the DutchMeshCore brokers
**Related:** #235 (the second-broker request, closed without a publish path on master), #374 (consuming the DutchMeshCore feed, not part of this), #454 (the backlog belongs to the companion that captured it), #563 (a loose boolean stays a checkbox), #230 (the watermark and retention)

## The problem

The app published to one broker, the one in `config.json`. Two things asked for more:

- A community that wants Mesh-Hunter receptions on its own broker had to fork the app or run its
  own deploy.
- Switching between a test broker and production meant a redeploy.

DutchMeshCore (DMC) is the first such broker, and it reads a different message than ours.

## What changed

1. **Several brokers.** `config.json` takes a `brokers` array next to `mqttUrl`. Every reception
   goes to each broker that is on. Each broker has its own publisher and its own watermark
   (`published_through:<id>`), and they drain side by side, so a broker that is offline or slow
   does not hold the others back. Retention deletes only below the lowest watermark of the brokers
   that are on.
2. **A brokers page** inside the settings sheet, reached from "Manage brokers" in the Status tab
   and from a row in the Settings tab. One row per broker with its state, what it is still owed,
   and a switch. A hunter can add a broker, and edit or remove the ones they added. Brokers from
   `config.json` can be switched off, not edited.
3. **Signing in with the companion's key.** A broker marked `auth: "companion"` takes no password.
   The companion signs a token itself (`CMD_SIGN_START`, `CMD_SIGN_DATA`, `CMD_SIGN_FINISH`), so
   the private key stays on the radio.
4. **The wardrive format.** A broker marked `format: "wardrive"` gets each reception as
   `wardriver/obs` and the phone's listening intervals as `wardriver/track`, under a stream label
   (`hunter`) instead of an airport code. AGENTS.md §9 has the fields.
5. **Presets** in the add form for the two DutchMeshCore collectors.

## Decisions, and why

- **Everything can be switched off, the site's own broker included.** A hunter decides where their
  positions go. The cost is named on the page: a broker that is off gets nothing.
- **A new broker starts at the newest reception.** A phone can hold a week of receptions, none of
  which was heard with that broker as a destination. The `mqttUrl` broker is the exception: it
  keeps the watermark key it always had, and a phone that captured offline before it ever
  connected still owes it the whole backlog.
- **Switching a broker back on also starts at the newest reception.** Off means "do not send my
  receptions there", and draining the hours it was off the moment it comes back would undo that.
  > **Amended 2026-09-23 (review of #671).** Off is a pause: on again drains from where the broker
  > stopped. A phone that captured a weekend with the site broker's switch off would otherwise
  > lose that weekend for the map, and with every broker off the prune had no floor and dropped
  > unsent rows past the age cap. The backlog leaves when the switch goes on, the hunter's
  > decision at that moment. `resumeAtHead` is gone; `forgetBroker` stays for a removed broker.
  >
  > **Amended 2026-09-24 (review of #671; Kasper chose this rule, option b, on 2026-09-25).** A pause keeps its backlog for the retention window,
  > not beyond it. While another broker is on, a paused broker does not hold the prune back, so
  > receptions older than 7 days that the brokers that are on already have are deleted, the paused
  > broker's backlog with them. Counting paused brokers would keep that backlog, but the store
  > would then grow for as long as a switch stays off, and switching a broker off for good is a
  > use the page offers (the site's own broker cannot be removed, only switched off). That is the
  > unbounded store #230 removed. With every broker off, all of them count: nothing leaves the
  > phone, and nothing unsent is deleted, as on a phone whose one broker never connected. The
  > rule is `owedBrokers` in `brokers.js`.
- **The form connects before it saves.** A typo in the address shows up under the field instead of
  as a dot that never lights. A broker that does not answer within 8 s is not stored.
- **A publish that is never acknowledged fails after 10 s.** A broker can accept the connection
  and drop the message without a PUBACK; mqtt.js then never calls back. With one broker that
  stalled one drain. With several it would have stalled all of them.
- **An added broker is wardrive unless "Advanced, Send as" says packets.** A hunter adds a broker
  to be on someone's map, and that is the format that carries a position per reception plus the
  track. The packets format is what a Mesh-Hunter server reads, so it stays reachable, one level
  down.
- **A reception whose frame cannot be hashed is passed over for a wardrive broker.** Without the
  hash a consumer cannot join it to anything, and failing the publish would block the queue behind
  it. The packets broker still gets it.
- **`listening` is only true while the radio is connected.** `rx_count: 0` with `listening: true`
  tells a triangulator the transmitter was not heard here. A dropped link closes the interval with
  `listening: false` instead of letting the next track count a dead link as silence.
- **The token is kept on the phone for its 24 h.** Publishing does not need the radio (#454): a
  hunter who parked with a full queue and unplugged the companion still gets the backlog out. The
  password of a password broker is kept the same way.
- **The DMC topic is `meshcore/hunter/...`, not an airport code.** On an airport topic a publisher
  is a fixed observer with one position. A hunter moves.
  > **Amended 2026-09-25 (Kasper, answering the review of #671).** DMC has two production stream
  > labels, and both belong to this app: `wardriver` for a coverage drive (DMC's wardrive map and
  > coverage hexes) and `hunter` for direction-finding and fox hunts (its hunter map and tactical
  > layer). On DMC's side the label decides a session's icon, its role column and the map that
  > shows it, so a hunt published under `wardriver` loses that. Both are fixed values, not the
  > hunter's region. `test` is the collector's sandbox region, not a production label: the live
  > app sends nothing there. The default stays `hunter`, since hunting is what this app is for. A
  > site lists each collector once per label in `brokerPresets`, and the hunter picks the preset
  > that fits the drive.
  >
  > A phone holds one label per collector. A broker's id is its address (`validateBroker`), so the
  > add form refuses the second preset of a collector that is already in the list. Going from a
  > hunt to a coverage drive means removing the broker and adding the other preset. Like any new
  > broker, that one starts at the newest reception, and whatever the removed one was still owed
  > is not sent.
- **One signature at a time.** The companion has a single sign buffer and a second
  `CMD_SIGN_START` empties it, so two brokers that both need a token queue up.
- **Each broker drains on its own promise** (2026-09-23, review of #671). A broker whose every
  publish waits out the 10 s ack timeout keeps draining across ticks on its own; the others take
  every tick. Joined in one tick, the slow one held the site broker's tick and, through the prune
  floor, the retention. Tracks step over a track that fails every pass, as receptions do.

## Two rules this touches

- **AGENTS.md "No secrets in the repo"** said never to commit broker URLs. The presets name the
  two DutchMeshCore collector hosts. Those are public: DutchMeshCore lists them for anyone who
  feeds its network, and a preset carries no credential. The rule now says so. This is a change to
  a hard rule and wants the maintainer's explicit yes; without it the presets move to
  `config.json`.
  > **Amended 2026-09-23.** The maintainer chose `config.json` (review of #671), so the rule stays
  > as it was and the presets are `brokerPresets` there (`presetsFrom` in `brokers.js`), each with
  > the stream `label` that broker acknowledges: the site sets its presets the way it sets
  > `mqttUrl`, and no third party's host is committed.
- **#563** decided that a boolean stays a checkbox. The switch on the brokers page is a new
  control. AGENTS.md §7 now says where it applies: one on/off per row in a list. A loose yes/no
  stays a checkbox.

## Not part of this

- Subscribing to the DutchMeshCore feed (#374).
- Regions, owner and clock of a repeater (#552).
- The splash and About do not name DutchMeshCore: it is a preset a hunter adds, not something that
  is on by default. The brokers page says where receptions go.

## Verified, and not

Unit tests cover the watermarks, the merge of site and hunter brokers, the form, the status lines,
the signing exchange (a real Ed25519 key behind a fake companion, the token checked with
`verifyAuthToken`), the packet hash (three reference hashes from an independent implementation and one
TRACE frame worked out with `node:crypto`), obs, track and the track window. Each new test was run
once with the code under it broken.

In the browser, against two local WebSocket brokers: an offline broker did not hold the other back
and caught up when it came online; a reception heard while a broker was off did not reach it; a
wrong port stored nothing; the wardrive broker received one obs and one track while the packets
broker received both receptions.

Not run against a real companion (signing, tracks while driving) or the DutchMeshCore brokers. On
21 September 2026 collector 1 accepted a companion-style sign-in and acknowledged a publish on the
`test` region, and did not acknowledge one on the `hunter` label.

> **Amended 2026-09-25.** That result fits a collector 1 still running the image from before
> Dutch-MeshCore/collector PR 5, which was merged on 21 September at 14:18 UTC. Before PR 5 the
> region slot took an IATA code or `test` only. It refused anything else as not three letters
> (`✗ Publish denied -> ... (invalid format)`) and closed the connection, so it refused
> `wardriver` just as it refused `hunter`. Since PR 5, `PUBLISH_EXTRA_REGIONS` (`src/config.ts`
> there) defaults to `wardriver,hunter` when unset, so every collector on the new image takes the
> same two labels unless its operator sets the variable to something else. A running collector picks the image up only after
> `docker compose pull broker && docker compose up -d broker` (`docs/updating-the-container.md`
> there). **Not verified:** whether collectors 1 and 2 have been updated since. An updated one
> logs `[AUTHZ] ✓ Using stream region -> meshcore/hunter/...` where the old one logged the denial.
> The topics under either label carry `/wardriver/`, and the collector delivers those only to its
> ADMIN and FULL_ACCESS subscribers, never to LIMITED ones (`authorizeForward` in `src/server.ts`).
