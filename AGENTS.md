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

### 5.3 Verify before claiming done

Before marking a task or PR complete:

1. Run the relevant test suite and confirm it passes:
   - `npx vitest run` in `app/`
   - `go test ./...` + `go vet ./...` in `server/`
2. Confirm the build is clean: `npm run build` in `app/`, `go build ./...` in `server/`.
3. For the app, serve over a secure context and do a manual smoke-test if BLE hardware is available.

Do not claim "done" based on intent. Run the commands and confirm green output.

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

Currently deferred (firmware-gated):
- `sender_role` — advert role byte decode is deferred until the byte layout is confirmed. It is
  plumbed end-to-end through capture, MQTT payload, and the ingestor schema, but always `null`.
  It will never contain a guessed value.

Resolved (firmware-confirmed):
- Companion spreading-factor readback — `PACKET_SELF_INFO` (0x05) byte 56 is the LoRa spreading
  factor, per the upstream MeshCore firmware's own `docs/companion_protocol.md` and the
  `out_frame` construction in `examples/companion_radio/MyMesh.cpp` (`CMD_APP_START` handler).
  No longer gated; used for SF-ordered resolver selection (see §8).

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
Receptions without a GPS fix are dropped at the PWA before publishing (no row, no publish).

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
