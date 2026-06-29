# core-hunter — Hashtag-channel name list (derive keys) — Implementation Plan

> Issue #10. Branch `feat/channel-names` → PR. Frontend-only. Built via SDD (single implementer + review).

**Goal:** Config lists public hashtag channels by **name**; the app derives the decryption key per name (`SHA256('#name')[:16]`) and adds them to the decoder keyStore. Adding channels = pasting names.

**Derivation (confirmed against CoreScope `channel-rainbow.json`):** `secret = first 16 bytes of SHA256(utf8(name))` where the name includes `#`. Golden vectors: `#test→9cd8fcf22a47333b591d96a2b848b73f`, `#chat→d0bdd6d71538138ed979eec00d98ad97`, `#public→8b4b705b080c0d943b1c80f6b3ef6b6d`.

## Files
- `app/src/config.js` — normalize new `channels: string[]`.
- `app/src/decode.js` — `initDecoder(channelKeys, channels)` + exported `deriveChannelSecret(name)`.
- `app/src/app.js` — pass `cfg.channels` to `initDecoder`.
- `app/public/config.example.json` — sample `channels`.
- Tests: `app/src/__tests__/config.test.js`, `app/src/__tests__/decode.test.js`.

## Task 1 — config.js `channels` normalization (TDD)
Add to `normalizeConfig`: `channels: []`. Normalize `raw.channels` (array): keep strings only; `trim()`; prepend `#` if missing; **dedup preserving order** (case-sensitive — the hash is case-sensitive); default `[]` when absent/not-an-array.
Test (config.test.js):
```js
it('normalizes channels: prepends #, dedups, drops non-strings', () => {
  const c = normalizeConfig({ mqttUrl: 'wss://x/ws', channels: ['#chat', 'test', '#chat', 5, ' #weer '] })
  expect(c.channels).toEqual(['#chat', '#test', '#weer'])
})
it('channels defaults to [] when absent/invalid', () => {
  expect(normalizeConfig({ mqttUrl: 'wss://x/ws' }).channels).toEqual([])
  expect(normalizeConfig({ mqttUrl: 'wss://x/ws', channels: 'nope' }).channels).toEqual([])
})
```

## Task 2 — decode.js derivation + merge + app wiring (TDD)
- Export `deriveChannelSecret(name)`:
```js
export function deriveChannelSecret(name) {
  const n = name.startsWith('#') ? name : '#' + name
  return CryptoJS.SHA256(n).toString(CryptoJS.enc.Hex).slice(0, 32) // first 16 bytes
}
```
- `initDecoder(channelKeys, channels)`: build a combined `{name: hexSecret}` map = derived-from-`channels` first, then explicit `channelKeys` (explicit **overrides** on name clash). Build keyStore from `Object.values(combined)` and `hashToName[sha256(secret)[0]] = name`. (Existing single-arg callers keep working: `channels` defaults to `[]`.)
- `app.js`: change the existing `initDecoder(cfg.channelKeys)` call to `initDecoder(cfg.channelKeys, cfg.channels)`.
- `config.example.json`: add `"channels": ["#meshcore", "#test"]`.
Tests (decode.test.js) — golden vectors lock the formula:
```js
import { deriveChannelSecret } from '../decode.js'
it('derives the hashtag-channel key (golden vectors)', () => {
  expect(deriveChannelSecret('#test')).toBe('9cd8fcf22a47333b591d96a2b848b73f')
  expect(deriveChannelSecret('#chat')).toBe('d0bdd6d71538138ed979eec00d98ad97')
  expect(deriveChannelSecret('public')).toBe('8b4b705b080c0d943b1c80f6b3ef6b6d') // '#' prepended
})
it('initDecoder maps a derived channel name by its hash', () => {
  initDecoder({}, ['#test'])
  const CryptoJS = require('crypto-js') // or import at top
  const h1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse('9cd8fcf22a47333b591d96a2b848b73f')).toString(CryptoJS.enc.Hex).slice(0,2)
  expect(channelNameFor(h1)).toBe('#test')
})
```
> Use a top-level `import CryptoJS from 'crypto-js'` in the test (ESM — not `require`).

## Verify
`cd app && npm run test` (config + decode green incl. golden vectors) + `npm run build`.

## PR
`gh pr create --base master` closing #10. Conventional `feat(app):` so release-please bumps app 0.2.0→0.3.0.
