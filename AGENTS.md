# AGENTS.md — core-hunter contributor guide

> For human contributors and AI agents alike. Read this before opening a PR or starting a task.
> Project-specific rules and working methodology are here. Detailed architecture and design decisions
> live in `docs/`.

---

## 1. What is core-hunter

A MeshCore **node-hunting / direction-finding** tool. A mobile **hunter** (BLE RX-scanner + live
thermal map) lets you drive or walk toward a **target node of any role type** (companion, repeater,
sensor, room-server, …) and home in on its physical location using radio signal (RSSI/SNR) via mesh
topology. A public-channel flooder is the motivating example, but the target can be any transmitting
node type. Improved successor to an earlier method. Two reused building blocks:

1. **Scanner base** — the **CoreDrive RX** scanner (`corescope-rx`): BLE to a companion radio,
   captures every direct reception from the `0x88` RX-log frame, tagged with the phone's GPS.
2. **Map / visualisation base** — the **CoreScope** map and point-visualisation layer: map setup,
   point/marker rendering, coverage/hex heat, and SNR/RSSI colour scaling.

**Direction-finding principle:** only what the hunter hears **directly (zero-hop, `hops === 0`)**
tells you where a transmitter is. A relayed packet's RSSI/SNR describes the last repeater that
forwarded it, not the target. Drive toward the strongest zero-hop heat to close in on the source.

**"Direct" is not "authenticated" (#320).** The hop count and path are plaintext header fields with
no signature or MAC over them. MeshCore does authenticate payloads (channel/direct MACs, an Advert's
Ed25519 signature) but never routing metadata — and core-hunter does not verify Advert signatures
today, since `decode.js` calls the synchronous decoder (#356). So any node transmitting directly to
the hunter can claim zero-hop, fabricate a relay path, or replay another node's identity.

RSSI/SNR are measured by our own radio and cannot be forged, so the map's **anonymous** coverage is
sound. But every claim of the form *"node N was here"* — Locate, drift, per-sender coverage — rests
on an identity the protocol does not authenticate: a forged sender id puts real measurements taken
at the attacker's position into that node's set, which moves its estimate, not just its label. See
`docs/2026-08-15-hop-count-trust.md`, and `docs/2026-08-17-fake-hop-detection.md` for why no
heuristic detector for a forged hop count is worth building (#321) — measured against real traffic,
every candidate is either indistinguishable from honest behaviour or needs data we do not record.

**Position disclaimer (required in all position-bearing output):** position is *inferred* from radio
measurements (RSSI, SNR) via mesh topology — **not** from GPS tracking of the target node. The GPS
coordinates stored with each reception are the **hunter phone's own position** at the moment of
reception. The map shows where *you* were when you heard the target, and how well, not where the
target is.

---

## 2. Repo layout

```
app/                  Mobile hunter PWA (Vite ES-module)
  src/
    app.js            Orchestrator: BLE → capture → IndexedDB → map tick → MQTT drain
    meshpacket.js     Packet parsing + classifyReception (capture rule)
    capture.js        buildRecord — assembles the reception record
    publisher.js      Publisher — builds and sends the MQTT payload
    filters.js        Pure makeFilter (sender / type / time-window / direct-only)
    signal.js         Thermal tier helpers (snrTier / rssiTier)
    huntmap.js        Leaflet map: signal points + hex-heat layer
    hexgrid.js        Hex-grid binning geometry
    transport.js      BLE transport (ported from CoreDrive RX)
    frames.js         0x88 RX-log frame decoder
    gps.js            Phone Geolocation wrapper
    selfinfo.js       Companion self-info (pubkey, name)
    names.js          Name resolver (pubkey → human name via CoreScope endpoint)
    config.js         Runtime config loader (reads public/config.json)
    queue.js          IndexedDB store (`core-hunter` db, `receptions` object store)
    styles/
      tokens.css      Design tokens (--ch-* variables, two themes: dark default + light)
      app.css         App-level styles (uses tokens only — no hardcoded colour values)
  src/__tests__/      Vitest unit tests (co-located with source)
  public/
    config.example.json  Template — copy to config.json and fill in broker details
  index.html
  vite.config.js
  package.json

server/               Go MQTT ingestor + SQLite
  cmd/ingestor/
    main.go           Entry point: config → store → MQTT → ingest loop + /healthz
  internal/config/    Config loader (config.Load)
  internal/store/     hunter_receptions schema, ParsePayload, Open/Insert/Close
  internal/ingest/    Handle(Store, topic, body, now) — broker-independent, never drops
  Dockerfile          Distroless CGO-free image (runs as uid 65532)
  config.example.json Template — copy to config.json on the deploy host

docs/                 Design specs and decision logs (read before changing behaviour)
  2026-06-28-iteration-1-decisions.md   Brainstorm Q&A log for iteration 1
  2026-06-29-iteration-2-proposals.md   Iteration 2 proposals (see section 7)
  superpowers/
    specs/            Architecture and data-model design docs
    plans/            Task-by-task implementation plans
*.md                  Project and contributor documentation
```

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| Mobile PWA | Vite ES-module, Web Bluetooth, phone Geolocation, `mqtt` 5.x over WSS, IndexedDB, Leaflet 1.9.4 |
| Unit tests (app) | Vitest (no browser required) |
| Go ingestor | Go 1.24+, `modernc.org/sqlite` (CGO-free), `eclipse/paho.mqtt.golang` |
| Unit tests (server) | `go test ./...` |
| Container | Docker distroless (non-root, uid 65532) |
| MQTT broker | EMQX; topic `meshcore/hunter/{rxPubkey}/packets`, QoS 1 |
| Storage (server) | SQLite, table `hunter_receptions`, no purge, UTC timestamps |
| Storage (app) | IndexedDB — `core-hunter` db, `receptions` store; local working set, drain to MQTT |

---

## 4. Build, run, and test

### App (`app/`)

```bash
npm install

# Dev server (http://localhost:5173 — qualifies as a secure context for Web Bluetooth)
npm run dev

# Production build
npm run build        # output in dist/
npm run preview      # serve dist/ locally

# Unit tests (Vitest, no browser)
npm run test
# or:
npx vitest run
```

**Configuration:** copy the example config before running:

```bash
cp public/config.example.json public/config.json
# then edit public/config.json — fill in mqttUrl, mqttUsername, mqttPassword
# optionally add resolveUrl or a resolvers array (see app/README.md)
```

`public/config.json` is gitignored. Never commit broker credentials.

Web Bluetooth and Geolocation require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
`localhost` qualifies; any other host must be served over HTTPS.

### Server (`server/`)

```bash
cd server

# Sanity check / CI
go test ./...
go build ./...
go vet ./...

# Run locally (needs a config.json next to the binary or at the path given by --config)
go run ./cmd/ingestor

# Docker build (for deploy)
docker build -t core-hunter-ingestor .
```

`server/config.json` is gitignored. Copy `server/config.example.json` and fill in broker details
before running.

---

## 5. How we work

### 5.0 Start every task with an issue — problem/feature → issue → PR

Before you start a new feature or fix, open a GitHub issue for it. The lifecycle of all work is:

> **problem or feature → issue → PR**

1. **Open the issue first.** Write down everything needed to act on it without guessing: the problem
   (or the feature and why it matters), the expected behaviour / acceptance criteria, which component
   it touches (`app` / `server` / `web`), and any reproduction steps, screenshots, logs, or context.
   If the request came from someone else and the information is incomplete, **ask the contributor for
   the missing details before starting** — do not begin coding against an underspecified issue.
2. **Work from that issue.** One issue = one focused logical change (the same one-change rule as PRs,
   see §6). If the work splits into independent pieces, open an issue per piece.
3. **Link the PR back to the issue.** Put a closing keyword in the PR description —
   `Closes #<n>` (or `Fixes #<n>`) — so merging the PR auto-closes the issue and the issue ↔ PR trail
   is preserved.

Why: the issue is the one place where the problem and the agreed scope are recorded *before* any code
exists. It lets any agent or contributor pick up the work with full context, keeps scope from
drifting, and gives every PR a traceable reason for existing. **No issue → no PR.**

### 5.1 Test-driven development (TDD) — required for every logic change

Follow **red → green** strictly:

1. Write the failing test first. Run it and confirm it fails **for the right reason** (not a
   compilation error, not the wrong assertion).
2. Implement the minimum code to make it pass.
3. Refactor if needed; keep the test green.

**Never write implementation before the failing test exists.**

**Mutation-check every new test.** Red→green is only worth what "red" proved. For a brand-new
module, red comes free from module resolution — that is the weakest possible form of it, and it
proves nothing about the assertion. So before a test counts as written: **revert the fix (or break
the one constant the test is about) and confirm the test goes red for the reason you intended.** A
`Failed to load url … Does the file exist?` is **not** red. Neither is a suite that stays green with
the code under test deleted.

Traps that produce a test which cannot fail — all of these shipped in one review round:

- **A synchronous fake hiding the ordering under test.** A stub that resolves immediately makes an
  await-ordering bug invisible; the test passes with the await removed.
- **An assertion already true from setup.** `expect(objects.some((o) => o.stopped)).toBe(true)` when
  something in the fixture is already stopped before the code under test runs.
- **Setup that stops the code under test from running at all.** `setMode('off')` returns early, so
  the listener the test is about is never attached, and the assertion measures nothing.
- **A tautology of the constant under test.** `expect(mvToPercent(3700)).toBe(50)` passes *because*
  the endpoints are the ones being questioned — it restates the implementation instead of pinning
  behaviour.
- **An assertion that restates a literal.** "`VIEW_STATES` has exactly these 5 states in this order"
  re-types the array; it fails only when someone edits the array *and forgets to edit the test*,
  which is not the bug worth catching.
- **A value the build or release process owns, retyped instead of imported.** The same instinct as
  the one above, with a worse consequence: it is not permanently green, it goes red later, in
  someone else's PR. `expect(seen).toBe('1.5.0')` where the code writes `VERSION` from
  `web/version.js` passes today and fails the moment release-please rewrites that line — on the
  release PR's own CI run, which is generated rather than authored, so nobody is looking for it.
  Import the value and assert against it; the release bump then updates the assertion with the
  code. Same for a version in `package.json`, a tag, or anything else a tool rewrites.

A useful test names a behaviour that could plausibly break and would matter if it did. If you cannot
describe the failure it would catch, it is not a test.

Test locations:
- `app/src/__tests__/` — Vitest; run with `npx vitest run`. No browser required.
- `server/internal/*/` — `go test ./...` in `server/`.

**What gets unit tests:** every pure / logic function. Examples: `classifyReception`,
`buildRecord`, `makeFilter`, `snrTier`, `rssiTier`, `ParsePayload`, `config.Load`, `ingest.Handle`.

**What does not get isolated unit tests:** DOM-bound and hardware-bound glue code — `app.js`
(orchestrator), `huntmap.js` (Leaflet map), `transport.js` (BLE). These are verified by a clean
build plus manual/field test. Keep testable logic in small, pure, importable functions so the
untestable surface stays thin.

**Never weaken a test to make it pass.** If a test exposes a real bug, fix the bug.

### 5.2 Task-by-task execution with two-stage review

Work is broken into small, well-specified tasks — one logical change per task. See the plan under
`docs/superpowers/plans/` for the style (explicit pre-conditions, file list, interfaces, step-by-step
with expected test output at each step).

After each task, apply a two-stage review before moving on:

1. **Spec compliance review:** did the implementation do exactly what the task spec asked — nothing
   more, nothing less? Check files created/modified, interfaces exposed, test coverage, and that no
   speculative code was added.
2. **Code quality review:** is the code clean, maintainable, and correct? Look for dead code,
   incorrect error handling, missing edge cases, naming clarity, and adherence to project conventions
   (CSS tokens, no secrets, etc.).

Fix any findings from both stages, then proceed to the next task.

Human contributors: keep PRs small and focused (one logical change), self-review against the spec
before requesting review, then do a quality pass.

This is the *per-task* review, and it is deliberately generic. The *per-push* one is §5.4, which
lists the specific failure classes this project keeps producing; run that one once, over the whole
diff, immediately before pushing.

### 5.3 Verify before claiming done

Before marking a task or PR complete:

1. Run the relevant test suite and confirm it passes:
   - `npx vitest run` in `app/`
   - `go test ./...` + `go vet ./...` in `server/`
2. Confirm the build is clean: `npm run build` in `app/`, `go build ./...` in `server/`.
3. For the app, serve over a secure context and do a manual smoke-test if BLE hardware is available.

Do not claim "done" based on intent. Run the commands and confirm green output.

### 5.4 Pre-push self-review

The last step before pushing a PR: read your own diff against this list. Every item below is a
blocker that was found in review more than once — on 2026-07-29 six of seven open PRs were sent back,
and almost every blocker was one of these seven, not something novel. Reading them here is cheaper
than being told again.

1. **Cause vs. symptom.** Does this fix the defect, or hide it? Clipping an overflowing label with
   CSS when the real bug is the label lookup makes the bug *less visible and still present* — and it
   stops being reported. Time-boxing a `z-index` overlap to two seconds is not fixing the overlap.
   If you are treating a symptom knowingly, say so in the PR and link the cause.
2. **Layout claims, computed rather than assumed.** If the PR says "it ellipsises", "it fits at
   360px", "it wraps" — compute it. Common misses: `text-overflow` does nothing on an anonymous flex
   item (the parent is `display: inline-flex`), a removed element's `bottom:`/`z-index` rule left
   behind holds its space, `min-width: 0` on exactly one flex item makes that item absorb the entire
   deficit, and a bare `#id` selector loses to an `#id element` one already in the sheet.
3. **Async state flips.** A guard cannot observe a state that flips on a later tick. Calling
   `resumeCue()` on the same tick as `ctx.resume()` drops the cue in exactly the case the change
   exists for. Rendering from data that arrives later needs a re-render when it does.
4. **Unhappy-path guards.** Does the feature still work when the *unrelated* call fails? A list that
   renders only inside the success branch of another fetch disappears for an unrelated outage. If
   every sibling on a path has a guard and yours does not, that is not simplification.
5. **Stale references after a removal.** Grep for what you deleted: selectors, selector lists naming
   a removed id, `aria-label`s for controls that no longer exist, and header comments now
   contradicting the code ("falls back to index 0" above a `return 1`).
6. **Identity rendering.** Never present a raw 64-hex pubkey or a 2-hex path hash as a name — in
   visible text, in a `title` tooltip, or anywhere else (`app/src/feed.js`, `app/src/names.js`, and
   §7's prefix-attribution rule). An id is an id; show it as one.
7. **Parity when replacing a control.** Replacing a native control means re-providing what it did:
   all options reachable (scrolling, not just the first page), type-ahead, and an on-screen trace of
   the active selection once the panel is closed. List what the old control did before deciding the
   new one is done.

Then the mechanical pass: tests and build green (§5.3), every new test mutation-checked (§5.1), no
secrets or local paths in the diff (§7), colours via tokens (§7), and the issue referenced with a
closing keyword (§5.0).

---

## 6. Git conventions

### Branch policy

The project commits directly to `master` and keeps `origin/master` green at all times. Every push
should leave the build and tests passing. Contributors working via a fork should keep PRs small and
focused; one logical change per PR.

Every PR traces back to an issue (§5.0). Reference it in the PR description with a closing keyword —
`Closes #<n>` / `Fixes #<n>` — so merging auto-closes the issue.

### Staging

**Always stage named files.** Never use `git add -A` or `git add .` — those can silently include
unintended files (credentials, local config, scratch files).

```bash
# correct
git add app/src/signal.js app/src/__tests__/signal.test.js

# never do this
git add -A
git add .
```

### Commits

One commit per logical change. Use **conventional commit** messages:

```
feat(app): add rssiTier with fixed dBm bands
feat(server): add raw_messages dead-letter table
fix(app): prevent map render when GPS fix is absent
fix(server): close store on SIGTERM before exiting
docs: update AGENTS.md with iteration-2 direction
chore: raise Go floor to 1.24 in go.mod and Dockerfile
test(app): add unit tests for makeFilter time-window
```

Scopes: `app` for the PWA, `server` for the Go ingestor, omit scope for repo-wide changes.

### Before pushing

Run tests + build and confirm green. Do not push a broken `master`.

---

## 7. Hard rules

### Firmware is authoritative for protocol and packet formats

Never guess byte layouts, field positions, or flag values. Only parse fields that the existing
parser (`meshpacket.js`) already exposes based on confirmed firmware knowledge. If a field's byte
layout is not confirmed from MeshCore firmware source, defer it: plumb the field as `null` /
`"unknown"` and leave a comment. Do not fill it with a guessed value.

**This covers constants, thresholds, unit conversions, curves and sentinel values too** — not only
layouts. A number that only means something because the firmware says so is a firmware fact, and
inventing one produces a confidently wrong reading rather than an obvious bug. Two real examples,
both caught in review of #323 — `app/src/battery.js` carries the resolution and is the worked
example to copy:

- A 3200–4200 mV battery curve was invented. Firmware defines the endpoints as **per-board build
  flags** — `BATT_MIN_MILLIVOLTS` / `BATT_MAX_MILLIVOLTS` in `examples/companion_radio/ui-*/
  UITask.cpp`, `#ifndef`-guarded to 3000/4200, and the T-Beam 1W variant overrides them to
  6000/8400 for its 2S pack (`variants/lilygo_tbeam_1w/platformio.ini`). On that board a full pack
  reads as flat.
- `battery_mv == 0` was treated as "empty" while firmware returns a literal `0` for boards with no
  VBAT sense at all (`src/helpers/ESP32Board.h` without `PIN_VBAT_READ`,
  `src/helpers/stm32/STM32Board.h` unconditionally), so the low-battery warning was permanently on
  for every one of them. Firmware agrees with itself here: its own auto-shutdown guard reads
  `milliVolts > 0 && milliVolts < AUTO_SHUTDOWN_MILLIVOLTS` (`ui-new/UITask.cpp`), i.e. `0` is "not
  a reading", not "empty".

A rule this specific is only worth what the check behind it is: **grep the firmware for the
constant before writing one.** `LOW_BATT_MILLIVOLTS` (3500, `ui-orig/UITask.cpp` only) was missed
exactly that way — `app/src/battery.js` carried "firmware defines no low-battery threshold" for a
release, which was true of the newer UI and wrong for the older one.

**Where the authoritative value is a per-board build flag the app cannot read over the wire, show
the raw measurement and omit the derived value** — "4020 mV" rather than a percentage computed from
endpoints we are guessing, and nothing at all where the sentinel says the board cannot measure it.
Same principle as plumbing `sender_role` through as `null`: an absent value is honest, a guessed one
is not.

Currently deferred (firmware-gated):
- `sender_role` — advert role byte decode is deferred until the byte layout is confirmed. It is
  plumbed end-to-end through capture, MQTT payload, and the ingestor schema, but always `null`.
  It will never contain a guessed value.

Resolved (firmware-confirmed):
- Companion spreading-factor readback — `PACKET_SELF_INFO` (0x05) byte 56 is the LoRa spreading
  factor, per the upstream MeshCore firmware's own `docs/companion_protocol.md` and the
  `out_frame` construction in `examples/companion_radio/MyMesh.cpp` (`CMD_APP_START` handler).
  No longer gated; used for SF-ordered resolver selection (see §8).

### Prefix attribution: the app refuses, the website may merge

One physical node is named by several different-length ids in the same pubkey namespace — the full
32-byte advert pubkey, an 8-byte (or full) discover prefix, a 1-3 byte relay path hash. Whether two
such ids may be treated as one node differs **per component, deliberately**:

- **App (`app/src/feed.js`, `web`-independent):** strict. A prefix attaches to a full pubkey only
  when a resolved name is present on **both** sides and matches. The app has a local capture store
  and can afford the name as a safety margin. Do not loosen this.
- **Website (`web/targetpicker.js`):** merging **is** allowed without a resolved name (#331). A
  prefix merges onto the longest id it belongs to when everything longer that it could be forms a
  single chain (`4a4a` → `4a4abe` → `4a4abe11…`).

**Why the app's gate is not reused, stated correctly:** not because names are absent. `sender_label`
is **not** only set by an advert — the repeater-name backfill writes it onto short prefixes too, so
in a live window roughly 19% of 2-byte and 20% of 3-byte relay ids carry a name, while the largest
long-id population (8-byte discover ids) carries none. Requiring a match on both sides would
therefore merge the labelled minority and leave the ~200 unlabelled prefix rows that #331 is about.
The gate stays loose; disagreement is what refuses.

The website's looser rule is bounded by refusals that must stay in place. Ambiguity is evidence
*against* merging, never for it — a wrong merge feeds two physically separate transmitters to Locate
as one target:

- two candidates that are not prefixes of each other (`4a4abe11…` vs `4a4aff…`) → the prefix stands
  on its own row
- `channel_name` ids never merge — that id is a decrypted display name, not part of the pubkey
  namespace
- two full pubkeys are two nodes, always
- any two members of the group resolved to *different* names → refuse, and refuse the **whole
  group**, not just the pair. This must be checked across the assembled group, not pairwise against
  the longest id: an unlabelled longest id is compatible with everything, so a pairwise-only check
  lets two members with disagreeing names meet through it. Because the common long id carries no
  label, that is the ordinary shape here rather than a corner case.
- merging starts at 2 bytes; a 1-byte path hash is 1-in-256, too coarse to attribute

A merged row is named by the node's own key (the longest id known for it) with the id still shown,
keeps the newest reception for RSSI and age, and carries `merged_ids` so one click selects every
prefix variant as one target. Its displayed name comes from the **longest** member that has one: a
name on a full advert pubkey came from the advert, whereas one on a 2-byte prefix is a backfilled
unique-match guess, so the two are not interchangeable.

This does **not** relax the separate, stricter rule on the website's node-position layer
(`web/map.js`, #296): a prefix is never resolved to a node *identity* there, because the resolver's
`ambiguous=false` is a per-registry claim and this side has no local registry to check it against.
Merging rows in a picker and trusting a prefix as an identity are different acts.

### Colours via CSS variables only

All colour values in component styles must use the `--ch-*` design tokens defined in
`app/src/styles/tokens.css`. No hardcoded hex, RGB, or HSL values in component stylesheets.
The app has two distinct themes (dark default + light); both must work.

```css
/* correct */
color: var(--ch-sig-hot);

/* never do this */
color: #ff4444;
```

### No secrets in the repo

`public/config.json` and `server/config.json` are gitignored. Never commit broker URLs,
usernames, passwords, or API keys. Never commit local filesystem paths, server hostnames, IPs,
or SSH keys. Local agent context (`CLAUDE.md`) is also gitignored.

Before publishing anything (docs, comments, commit messages), scrub all infrastructure detail.

### No per-packet API calls from the frontend

The PWA must not make an individual API or HTTP request per received packet. Bulk fetch and
filter client-side. Name resolution is cached per pubkey.

### Database is UTC

All timestamps in `hunter_receptions` are UTC. Convert to local time only in the display layer.

### No speculative features

Implement exactly what the task spec asks. Do not add error-handling, validation, or behaviour
for scenarios that cannot occur within the current design. Do not pre-implement future iteration
features unless the spec explicitly includes them.

### Position disclaimer in all position-bearing output

Any output that displays or implies a target's location must state clearly:

> Position is inferred from radio measurements (RSSI/SNR) via mesh topology — not from GPS
> tracking of the target. The stored GPS coordinates are the hunter phone's own position at
> the time of reception.

**How long it must be shown (amended 2026-08-21, #413).** The disclaimer, and any key explaining
position-bearing glyphs, must be **shown when the output is switched on and remain reachable
afterwards** — not necessarily displayed permanently. For the node-position layer, "reachable"
means every marker popup carries it (`.np-caveat`); the on-screen key is a glance on each
activation.

The earlier rule was permanent display, and it was dropped for a concrete reason rather than for
convenience: #306 moved these notices into `#toast-stack` at the top of the screen, #322 then put
the enlarged receptions ticker in the same band, and a permanent key sat on the ticker for the whole
session. See `docs/2026-08-21-nodepos-key-glance.md`.

**What is not a glance:** a line reporting that nothing could be drawn — an empty registry, an
unreachable resolver — is an explanation, not a label, and stays for as long as the state does.
Fading it makes "we got nothing" and "there is nothing here" look alike, which is the failure #307
exists to prevent.

---

## 8. Where decisions live — iteration model

### Decision log

Design decisions are recorded as dated Markdown documents under `docs/`:

- **Brainstorm / decision log per iteration** — all questions, options considered, and final
  answers. Read the relevant log before changing behaviour; do not silently re-litigate a locked
  decision. Open a discussion or update the doc if you believe a decision needs revisiting.
- **Spec docs** (`docs/superpowers/specs/`) — architecture, data model, MQTT contract.
- **Implementation plans** (`docs/superpowers/plans/`) — bite-sized TDD task lists with
  pre-conditions, file lists, interfaces, and step-by-step expected outputs.

### Current iteration direction — iteration 2 (in progress)

Read [`docs/2026-06-29-iteration-2-proposals.md`](docs/2026-06-29-iteration-2-proposals.md) for
the full picture. Key changes under review or decided for iteration 2:

- **Zero-hop only.** Only what the hunter hears directly (`hops === 0`) is relevant for locating
  a target. Relayed (>0-hop) traffic is dropped from logging, MQTT publishing, and the map.
  The 1-byte sender-prefix attribution axis (which applied only to relayed FLOOD packets) is
  dropped accordingly. Zero-hop senders are either a full advert pubkey or `null` (unattributed).
- **Default signal metric: RSSI.** Fixed dBm bands (not auto-scaled) for the app; per-hunter
  relative normalisation on the multi-hunter website. SNR is still stored and may be displayed,
  but colour/heat defaults to RSSI. Optional per-device calibration offset in config.
- **Ignore-list.** A mute list of known station pubkeys (e.g. nearby repeaters that would form
  false hotspots) filters the map and hex-heat at render time. Capture and storage are unaffected
  (no purge). Ignore is a display/query filter, not a capture filter. Matching is on the full
  pubkey (always available at zero-hop). Backend ignore-list is global across all hunters.
- **Multiple regional name resolvers.** `config.json` accepts a `resolvers` array, each entry
  with a `label`, `sf`, and `url`. Resolvers matching the companion's spreading factor (read from
  `PACKET_SELF_INFO`, see §7) are tried first, config order otherwise; the first unambiguous hit
  wins.
  The legacy single `resolveUrl` field remains supported.

Iteration 1 code that will change in iteration 2 (after proposals are ratified):
- `meshpacket.js · classifyReception` — keep only `hops === 0` records.
- `capture.js` / `publisher.js` — drain zero-hop only to MQTT.
- `huntmap.js` — remove faded relay points; apply ignore-list to points and hex-binning.
- `filters.js` — add ignore-list predicate; `directOnly` becomes implicit.
- `signal.js` — add `rssiTier(rssi)` with fixed dBm bands; map/HUD/heat default to RSSI.

Do not implement these changes until the iteration-2 proposals are formally ratified.

---

## 9. MQTT payload contract (PWA → ingestor)

Topic: `meshcore/hunter/{rxPubkey}/packets`, QoS 1.

Payload (JSON):

```json
{
  "origin_id":   "<rxPubkey>",
  "origin":      "<companion name>",
  "timestamp":   "<rx_at RFC3339 UTC>",
  "type":        "PACKET",
  "direction":   "rx",
  "raw":         "<full packet hex>",
  "SNR":         -3.5,
  "RSSI":        -92,
  "is_direct":   true,
  "hops":        0,
  "sender_key":  "a1b2c3...",
  "sender_keylen": 32,
  "sender_role": null,
  "packet_type": "channel-msg",
  "gps": { "lat": 51.0, "lon": 4.0, "acc_m": 8 }
}
```

The PWA publishes everything the companion hears (iteration 1) — or all zero-hop receptions
(iteration 2 after ratification). The local map filter (direct/all toggle) affects only the local
view, not what is published upstream. The ingestor deduplicates by `(origin_id, rx_at, sender_key)`.
Receptions without a GPS fix are dropped at the PWA before publishing (no row, no publish), and a
fix too inaccurate to place one is refused there too (#274).

**`gps` is required; `acc_m` is optional.** `lat` and `lon` must both be present — a payload without
them is dead-lettered into `raw_messages` rather than stored, since a value type would turn the
absence into 0,0, a real coordinate off West Africa. `acc_m` may be absent or `null` when the device
reports no accuracy figure; it is then stored as SQL `NULL`, never as `0` — which would mean the most
accurate fix in the table (#346). Keep the ingestor's `gps` fields pointers for exactly this reason.

---

## 10. Resilience invariants (do not break)

- Receptions are written to IndexedDB **before** any MQTT publish attempt. The map renders from the
  local store on every tick.
- The MQTT drain loop publishes rows to the broker and deletes a local row **only** once that row has
  reached the broker *and* has aged past the retention window (7 days). A reception that has not been
  published is never deleted, however old — an offline phone keeps everything until it drains.
  IndexedDB is the working set; the backend deduplicates. Publication is tracked by a durable
  watermark, not an in-memory set, so a restart does not re-publish the store.
  See `docs/2026-07-22-retention-and-bounded-reads.md` (#230); this replaces an earlier absolute
  "never deletes local rows" rule, which made the store unbounded.
- Queue reads are **bounded** — never `getAll()` over the store. The display reads its time window via
  the `rx_at` index, the non-window surfaces read the newest `RECENT_CAP` rows, and the drain reads
  only above the watermark. An O(store) read on a tick is a performance bug, not a style preference.
- If BLE drops, MQTT drops, or the browser is closed and reopened, the map reloads from stored
  data and continues filling after reconnect.
- The ingestor uses a **persistent MQTT session** (`CleanSession=false`) so the broker queues QoS 1
  messages during ingestor downtime. Together with the PWA's IndexedDB queue, this is the
  "no lost receptions" guarantee.
- Parse failures and insert failures in the ingestor divert to a `raw_messages` dead-letter table —
  no message is silently dropped.
