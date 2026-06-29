# core-hunter — Iteration 4: live Messages feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live bottom Messages panel that streams decrypted channel messages + adverts (newest-first), tappable to focus the map and to Isolate/Ignore — frontend-only.

**Architecture:** A pure `feed.js` selects/sorts the feed items from the existing IndexedDB record snapshot (same data the map renders). A DOM-only `feedpanel.js` renders the collapsible panel. `app.js` builds the items in the existing 1s render tick and drives the panel; `huntmap.js` gains `focusReception(rec)` and drops the redundant `hops 0` from the popup. No `server/` change.

**Tech Stack:** Vite ES-module PWA, Vitest, Leaflet (existing). Branch `feat/messages-feed` → PR.

## Global Constraints

- Frontend-only. **No `server/` change**, no DB/payload change, decrypted text never stored/published.
- Feed scope: `sender_kind ∈ { 'channel_name', 'advert_pubkey' }` only. Ignore-list applied (drop `sender_id`s in `state.ignore`, lowercased); otherwise independent of map isolate/time filters.
- **No hop badge** in the feed; also remove the `hops 0 ·` line from the marker popup (all displayed receptions are zero-hop).
- Feed renders from `queue.takeAll()` snapshot in the existing `renderTick` (app.js:169); newest-first; limit 50.
- Row tap → `map.focusReception(rec)`. Row actions reuse the existing `hunt:isolate-sender` / `hunt:ignore-sender` CustomEvents (`detail: { id }`).
- Attacker-controlled text (decrypted message, sender label) rendered via DOM `textContent` (not innerHTML) — no injection.
- Colours via `--ch-*` CSS vars only. Tests required for the pure module. Explicit `git add`; commit body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. All work on branch `feat/messages-feed`.

---

## Task 1: `feed.js` — pure feed selection + relative time

**Files:**
- Create: `app/src/feed.js`
- Test: `app/src/__tests__/feed.test.js`

**Interfaces:**
- Produces:
  - `feedItems(records, { ignore, limit = 50 } = {})` → array filtered to `sender_kind ∈ {channel_name, advert_pubkey}`, excluding any whose `sender_id` (lowercased) is in the `ignore` Set, sorted by `rx_at` descending, capped to `limit`.
  - `relTime(rxAt, nowMs)` → `'<n>s'` (<60s), `'<n>m'` (<60m), else `'<n>h'`.

- [ ] **Step 1: Write the failing tests**

`app/src/__tests__/feed.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { feedItems, relTime } from '../feed.js'

const rec = (o) => ({ sender_kind: 'channel_name', sender_id: 'Spammer', rx_at: '2026-06-29T10:00:00Z', ...o })

describe('feedItems', () => {
  it('keeps only channel_name + advert_pubkey kinds', () => {
    const out = feedItems([
      rec({ sender_kind: 'channel_name', sender_id: 'A' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: 'B' }),
      rec({ sender_kind: 'direct_hash', sender_id: 'C' }),
      rec({ sender_kind: null, sender_id: null }),
    ], {})
    expect(out.map((r) => r.sender_id)).toEqual(['A', 'B'])
  })
  it('drops ignored sender ids (case-insensitive)', () => {
    const out = feedItems([rec({ sender_id: 'AA' }), rec({ sender_id: 'bb' })], { ignore: new Set(['aa']) })
    expect(out.map((r) => r.sender_id)).toEqual(['bb'])
  })
  it('sorts newest-first and respects limit', () => {
    const out = feedItems([
      rec({ sender_id: 'old', rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_id: 'new', rx_at: '2026-06-29T10:05:00Z' }),
      rec({ sender_id: 'mid', rx_at: '2026-06-29T10:02:00Z' }),
    ], { limit: 2 })
    expect(out.map((r) => r.sender_id)).toEqual(['new', 'mid'])
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-06-29T10:05:00Z')
  it('formats s/m/h', () => {
    expect(relTime('2026-06-29T10:04:30Z', now)).toBe('30s')
    expect(relTime('2026-06-29T10:02:00Z', now)).toBe('3m')
    expect(relTime('2026-06-29T08:05:00Z', now)).toBe('2h')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd app && npx vitest run src/__tests__/feed.test.js`
Expected: FAIL (`feed.js` missing).

- [ ] **Step 3: Implement `feed.js`**

`app/src/feed.js`:
```js
const FEED_KINDS = new Set(['channel_name', 'advert_pubkey'])

export function feedItems(records, { ignore, limit = 50 } = {}) {
  const ig = ignore || new Set()
  return (records || [])
    .filter((r) => FEED_KINDS.has(r.sender_kind))
    .filter((r) => !(r.sender_id != null && ig.has(String(r.sender_id).toLowerCase())))
    .slice()
    .sort((a, b) => Date.parse(b.rx_at) - Date.parse(a.rx_at))
    .slice(0, limit)
}

export function relTime(rxAt, nowMs) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd app && npx vitest run src/__tests__/feed.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/feed.js app/src/__tests__/feed.test.js
git commit -m "feat(app): feed.js — pure channel+advert feed selection + relTime"
```

---

## Task 2: `huntmap.js` — `focusReception` + drop `hops 0` from popup

**Files:**
- Modify: `app/src/huntmap.js`

**Interfaces:**
- Produces: `createHuntMap(...)` return object gains `focusReception(rec)` — centres the map on `rec.lat/lon` and opens a popup there (same content + Isolate/Ignore wiring as a marker popup). The popup no longer shows a `hops` line.

> DOM/Leaflet glue — verified by `npm run build` + manual test (no unit test, per AGENTS.md).

- [ ] **Step 1: Add `focusReception` inside `createHuntMap`**

In `app/src/huntmap.js`, before the `return { ... }` at line ~106, add:
```js
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    centerOn(rec.lat, rec.lon)
    const popup = L.popup({ autoPan: true }).setLatLng([rec.lat, rec.lon]).setContent(popupHtml(rec)).openOn(map)
    wireIsolate(popup, rec)
    wireIgnore(popup, rec)
  }
```
Add `focusReception` to the return object:
```js
  return { setPosition, centerOn, recenter, onFollowChange, render, setLayerMode, applyBasemap, focusReception, destroy }
```
And to the no-Leaflet stub on line 8, add `focusReception() {},` to the returned object.

- [ ] **Step 2: Remove the `hops 0` line from `popupHtml`**

In `popupHtml` (line ~116-118), delete the hops line so the type stays but the hop count is gone. Change:
```js
  return `<div class="ch-popup">SNR ${esc(r.snr)} · RSSI ${esc(r.rssi)}<br>`
    + `hops ${esc(r.hops)} · ${esc(r.packet_type)}<br>`
    + senderLine + chanLine + textLine + '<br>'
```
to:
```js
  return `<div class="ch-popup">SNR ${esc(r.snr)} · RSSI ${esc(r.rssi)}<br>`
    + `${esc(r.packet_type)}<br>`
    + senderLine + chanLine + textLine + '<br>'
```

- [ ] **Step 3: Build + commit**

Run: `cd app && npm run build`
Expected: build succeeds.
```bash
git add app/src/huntmap.js
git commit -m "feat(app): map.focusReception + drop redundant hops-0 from popup"
```

---

## Task 3: `feedpanel.js` + panel DOM + styles

**Files:**
- Create: `app/src/feedpanel.js`
- Modify: `app/index.html` (add the panel markup)
- Modify: `app/src/styles/app.css` (panel styling via `--ch-*` tokens)

**Interfaces:**
- Consumes: `relTime` from `feed.js`.
- Produces: `createFeedPanel(rootId, { onTapRow, onIsolate, onIgnore })` → `{ render(items, nowMs), toggle() }`.
  - `render` rebuilds the list (newest-first items), updates the `(N)` count, and (when collapsed) leaves only the handle visible.
  - Rows render label/text via `textContent` (no innerHTML) — safe for attacker content.
  - Tapping a row body calls `onTapRow(rec)`; the two row buttons call `onIsolate(rec.sender_id)` / `onIgnore(rec.sender_id)`.

> DOM glue — verified by `npm run build` + manual test.

- [ ] **Step 1: Add the panel markup to `index.html`**

In `app/index.html`, immediately before `<section id="hud">` (line ~21), add:
```html
  <section id="feed-panel" class="collapsed">
    <button id="feed-handle" type="button">▲ Messages <span id="feed-count">(0)</span></button>
    <ul id="feed-list"></ul>
  </section>
```

- [ ] **Step 2: Implement `feedpanel.js`**

`app/src/feedpanel.js`:
```js
import { relTime } from './feed.js'

// createFeedPanel wires the bottom Messages panel. Rows are built with the DOM
// API + textContent so attacker-controlled message text cannot inject HTML.
export function createFeedPanel(rootId, { onTapRow, onIsolate, onIgnore } = {}) {
  const root = document.getElementById(rootId)
  if (!root) return { render() {}, toggle() {} }
  const handle = root.querySelector('#feed-handle')
  const countEl = root.querySelector('#feed-count')
  const list = root.querySelector('#feed-list')
  handle.addEventListener('click', () => root.classList.toggle('collapsed'))

  function row(rec) {
    const li = document.createElement('li')
    li.className = 'feed-item'

    const body = document.createElement('button')
    body.type = 'button'; body.className = 'feed-row'
    const rssi = document.createElement('span'); rssi.className = 'feed-rssi'; rssi.textContent = String(rec.rssi ?? '—')
    const label = document.createElement('span'); label.className = 'feed-label'
    label.textContent = rec.sender_label || rec.sender_id || '—'
    const mid = document.createElement('span'); mid.className = 'feed-mid'
    mid.textContent = rec.sender_kind === 'channel_name' ? (rec._text || '') : 'advert'
    const time = document.createElement('span'); time.className = 'feed-time'
    time.textContent = relTime(rec.rx_at, Date.now())
    body.append(rssi, label, mid, time)
    body.addEventListener('click', () => onTapRow && onTapRow(rec))

    const iso = document.createElement('button'); iso.type = 'button'; iso.className = 'feed-iso'; iso.textContent = '⊙'
    iso.title = 'Isolate sender'; iso.addEventListener('click', () => onIsolate && onIsolate(rec.sender_id))
    const ign = document.createElement('button'); ign.type = 'button'; ign.className = 'feed-ign'; ign.textContent = '⊘'
    ign.title = 'Ignore this ID'; ign.addEventListener('click', () => onIgnore && onIgnore(rec.sender_id))

    li.append(body, iso, ign)
    return li
  }

  function render(items, _nowMs) {
    countEl.textContent = '(' + items.length + ')'
    list.replaceChildren(...items.map(row))
  }

  return { render, toggle: () => root.classList.toggle('collapsed') }
}
```

- [ ] **Step 3: Style the panel in `app.css`**

Append to `app/src/styles/app.css` (positioned above the HUD; collapsed shows only the handle):
```css
#feed-panel {
  position: fixed; left: 0; right: 0; bottom: var(--ch-hud-h, 96px); z-index: 5;
  background: var(--ch-surface); color: var(--ch-text);
  border-top: 1px solid var(--ch-border, rgba(255,255,255,0.08));
  display: flex; flex-direction: column; max-height: 45vh;
}
#feed-handle {
  background: transparent; color: var(--ch-text); border: 0; text-align: left;
  padding: 8px 12px; font: inherit; cursor: pointer;
}
#feed-count { color: var(--ch-muted, #9aa); }
#feed-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
#feed-panel.collapsed #feed-list { display: none; }
.feed-item { display: flex; align-items: center; border-top: 1px solid var(--ch-border, rgba(255,255,255,0.06)); }
.feed-row { flex: 1; display: grid; grid-template-columns: 3.5em 1fr auto; gap: 8px; align-items: baseline;
  background: transparent; color: var(--ch-text); border: 0; text-align: left; padding: 8px 10px; font: inherit; cursor: pointer; }
.feed-rssi { color: var(--ch-accent); font-variant-numeric: tabular-nums; }
.feed-label { font-weight: 600; }
.feed-mid { color: var(--ch-muted, #9aa); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feed-time { color: var(--ch-muted, #9aa); font-variant-numeric: tabular-nums; }
.feed-iso, .feed-ign { background: transparent; color: var(--ch-text); border: 0; padding: 0 10px; font-size: 1.1em; cursor: pointer; }
```
> If `--ch-hud-h`/`--ch-border`/`--ch-muted` aren't defined, the fallbacks apply; if the existing tokens use different names, use those instead — keep colours token-based.

- [ ] **Step 4: Build + commit**

Run: `cd app && npm run build`
Expected: build succeeds.
```bash
git add app/src/feedpanel.js app/index.html app/src/styles/app.css
git commit -m "feat(app): Messages panel DOM + feedpanel.js renderer + styles"
```

---

## Task 4: wire the feed into the render tick

**Files:**
- Modify: `app/src/app.js`

**Interfaces:**
- Consumes: `feedItems` (Task 1), `createFeedPanel` (Task 3), `state.map.focusReception` (Task 2), existing `hunt:isolate-sender`/`hunt:ignore-sender` events + `state.ignore`.

> DOM glue — verified by `npm run build` + full `npm run test` (the pure suites stay green) + manual/field test.

- [ ] **Step 1: Import + create the panel**

In `app/src/app.js` add imports near the existing ones:
```js
import { feedItems } from './feed.js'
import { createFeedPanel } from './feedpanel.js'
```
Add a `feed` slot to the `state` object (near `ignore: loadIgnore(),`):
```js
  feed: null,
```
In init (near `state.map = createHuntMap('map')`, line ~547), create the panel:
```js
  state.feed = createFeedPanel('feed-panel', {
    onTapRow: (rec) => { if (state.map) state.map.focusReception(rec) },
    onIsolate: (id) => document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id } })),
    onIgnore: (id) => document.dispatchEvent(new CustomEvent('hunt:ignore-sender', { detail: { id } })),
  })
```

- [ ] **Step 2: Build the feed in `renderTick`**

Replace the body of `renderTick` (app.js:169-184) so `rows`/`now` are fetched once and both map and feed render:
```js
async function renderTick() {
  try {
    setDot('dot-mqtt', state.publisher != null && state.publisher.connected())
    const rows = await state.queue.takeAll()
    const now = Date.now()
    if (state.map) {
      const fn = makeFilter({ ...state.filter, ignore: state.ignore })
      state.map.render(rows.filter((r) => fn(r, now)), now)
    }
    if (state.feed) state.feed.render(feedItems(rows, { ignore: state.ignore, limit: 50 }), now)
  } catch (_) {
    // silent — render failure must not crash the loop
  }
  setTimeout(renderTick, 1000)
}
```

- [ ] **Step 3: Build + full test + commit**

Run: `cd app && npm run build && npm run test`
Expected: build succeeds; full Vitest suite passes (feed suite + all existing).
```bash
git add app/src/app.js
git commit -m "feat(app): drive Messages panel from the render tick"
```

---

## Task 5: open the PR

**Files:** none (operational).

- [ ] **Step 1: Push the branch**

Run: `git push origin feat/messages-feed`

- [ ] **Step 2: Open the PR (closes #6)**

```bash
gh pr create --base master --head feat/messages-feed \
  --title "Live Messages feed (decrypted channel messages + adverts)" \
  --body "$(cat <<'EOF'
Implements #6 — a live bottom Messages panel listing decrypted channel messages + adverts, newest-first, tappable to focus the map and Isolate/Ignore. Frontend-only; no backend/storage change. Also removes the redundant `hops 0` from the marker popup.

## Test
- `cd app && npm run test` (feed.js unit tests + existing suite) + `npm run build`.
- Field: a public-channel message appears in the feed (sender + text + RSSI + time) without tapping the map; adverts show node name/pubkey; ignored senders don't appear; tapping a row focuses the map; Isolate/Ignore work from the row.

Closes #6

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification (end-to-end)

1. `cd app && npm run test` → feed + all existing suites pass.
2. `cd app && npm run build` → clean.
3. Field: open the deployed (PR-preview or post-merge) app, connect companion; channel messages stream into the Messages panel; tap a row → map centres + popup; Isolate/Ignore from a row narrow/hide; popup no longer shows `hops 0`.

## Self-review notes (spec coverage)

- Scope channel+advert, ignore-list applied → Task 1 (`feedItems`). Bottom collapsible panel + row content (no hop badge) → Task 3. Tap→focus + inline isolate/ignore → Tasks 2 (`focusReception`) + 3/4 (wiring to existing events). Popup `hops 0` removal → Task 2. Frontend-only/no storage → no `server/` task; text via `textContent` → Task 3. PR flow → Task 5 (issue #6 already created).
