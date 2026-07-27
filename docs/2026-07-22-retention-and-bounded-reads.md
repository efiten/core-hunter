# core-hunter — Bounded queue reads + local retention (DECIDED)

> Date: 2026-07-22. **Status: DECIDED — implemented in the same PR as this document.**
> Context: [#230](https://github.com/efiten/core-hunter/issues/230). This document exists because the
> change alters a resilience invariant documented in `AGENTS.md` §10, which per §8 may not be changed
> silently.

## Problem

Both the render tick (1 s) and the drain tick (5 s) read the **entire** `receptions` object store via
`getAll()`. Nothing ever deleted rows, so N grew without bound across the lifetime of an install and
every tick cost O(total receptions ever captured).

Measured on desktop Chrome (a phone is typically 4–8× slower):

| rows | `takeAll()` | JS filter + sort + list building | total per 1 s tick |
|---|---|---|---|
| 1,000 | 5 ms | 7 ms | ~12 ms |
| 5,000 | 18 ms | 16 ms | ~34 ms |
| 20,000 | 79 ms | 34 ms | ~113 ms |
| 50,000 | 291 ms | 68 ms | **~359 ms** |

Past ~20k rows the tick exceeds its budget on mobile hardware, each tick starts before the previous
one finished, and the main thread saturates permanently. All three symptoms in #230 follow from that
single cause: the renderer is starved (ghosted controls, contentless markers), the MQTT keepalive is
missed so the broker drops the connection (`MQTT: Not connected`), and the login `fetch` cannot be
serviced so it returns `Login failed — check your connection.` on correct credentials.

Restarting made it worse, not better: drain dedup was an in-memory `Set`, empty on every boot, so the
first drain after a relaunch re-published the entire store one `await` at a time.

## Decision

Two changes, together.

### 1. Bounded reads

No read is O(store) any more:

| read | scope | mechanism |
|---|---|---|
| map / display | the chosen time window | `rx_at` index + `IDBKeyRange.lowerBound` |
| receptions log "all", target list | newest `RECENT_CAP` (2000) rows | reverse cursor on the id |
| drain | rows above the watermark | `IDBKeyRange.lowerBound(watermark, true)` |

Schema goes from `version: 1` to `version: 2`: an `rx_at` index on `receptions`, plus a small `meta`
store holding the publish watermark. Creating an index indexes the rows already present, so an
upgraded install needs no explicit backfill pass.

The **watermark** ("every row at or below this id has reached the broker") is persisted in IndexedDB
and replaces the in-memory `Set`. It only advances over an unbroken run of successful publishes: on a
failure the drain stops there and retries the remainder next cycle, rather than skipping ahead.

`windowMs` may be `null` ("no time filter"). That now reads the whole *retained* store, which
retention bounds at 7 days.

### 2. Retention — and what it may not do

Receptions older than **7 days** are pruned, hourly, from the drain tick.

**A row is only ever deleted once it is at or below the watermark.** "All receptions go to MQTT"
outranks the age cap: a phone that has been offline for a month keeps every unpublished row until it
drains, however old. Age alone never deletes anything.

## Change to AGENTS.md §10

Previously:

> The MQTT drain loop publishes rows to the broker but **never deletes local rows**. IndexedDB is the
> working set; the backend deduplicates.

The absolute form of that invariant is what made the store unbounded, which is the bug. It is replaced
by a conditional form: local rows are deleted **only** after they have reached the broker and only
past the retention window. The guarantee the invariant was protecting — "no lost receptions" — is
untouched, because the condition for deletion *is* successful publication.

## Alternatives rejected

- **In-memory working set + incremental reads.** No schema change, but boot stays O(N), so the freeze
  moves to app launch — before the UI is usable, which is worse. Memory also grows across a session.
- **Retention alone, without bounded reads.** Caps N, but a heavy week still lands near 10–15k rows,
  measured at ~60–100 ms per tick on desktop. It defers the problem rather than removing it.
- **Bounded reads alone, without retention.** Leaves an unbounded store on disk and keeps the "all"
  reads dependent on a row cap to stay cheap. Chosen together instead: reads stop being O(N), *and*
  N stops growing.

## Not addressed here

- `rxView` (`receptionlog.js`) still sorts its input with a `Date.parse` comparator before capping.
  That input is now bounded to `RECENT_CAP` rows, so it is no longer an O(store) pass; making it
  cap-before-sort is a separate, smaller cleanup.
- The MQTT `keepalive` is now set explicitly (30 s) instead of relying on mqtt.js's 60 s default. This
  does not prevent a saturation-induced drop — it makes the window a deliberate number in our code.
