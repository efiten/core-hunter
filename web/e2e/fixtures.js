import { test as base, expect } from '@playwright/test'

// Hermetic e2e: block every third-party origin the page would otherwise hit for
// real on each load — basemap tiles (cartocdn), Leaflet itself (unpkg), and the
// top bar's node counts (corsproxy, which is production infrastructure).
//
// None of them affect a single assertion, but at 4 workers × ~50 tests they add
// hundreds of real network requests per run. They saturate each page's
// connection pool, which is what made unrelated tests time out at 30 s on
// `fill`, `click` and `waitForRequest` — the suite's long-standing flakiness.
// Leaflet is the one exception that must still resolve, since `L` is required
// for the map to exist at all; it is allowed through and browser-cached.
const BLOCKED = [
  '**/*.basemaps.cartocdn.com/**',
  '**/basemaps.cartocdn.com/**',
  '**/corsproxy.on8ar.eu/**',
]

// Leaflet is the one third-party request that must still resolve — `L` is
// required for the map to exist at all — and it was left going to the real
// unpkg.com. Every test loads the page in a fresh context, so that is one
// real 150 kB CDN round-trip per test, 87 per run, all landing at once under
// parallel load: the page boots slowly, map.js is still evaluating when the
// first click arrives, and the failures land on whichever tests were unlucky.
//
// Fetched once per worker process and replayed from memory instead. The
// promise (not the body) is cached so concurrent tests share the one fetch,
// and a failure is not cached — the next test retries rather than inheriting
// a permanent empty Leaflet.
const CDN = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css']
const cdnCache = new Map()
function cdnBody(url) {
  if (!cdnCache.has(url)) {
    cdnCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url} -> ${r.status}`)
      return r.text()
    }).catch((e) => { cdnCache.delete(url); throw e }))
  }
  return cdnCache.get(url)
}

export const test = base.extend({
  page: async ({ page }, use) => {
    for (const pattern of BLOCKED) await page.route(pattern, (r) => r.abort())
    for (const url of CDN) {
      const contentType = url.endsWith('.css') ? 'text/css' : 'application/javascript'
      await page.route(url, async (route) => {
        try {
          const body = await cdnBody(url)
          await route.fulfill({ status: 200, contentType, body })
        } catch (_) {
          await route.continue() // network hiccup: fall back to the real thing
        }
      })
    }
    await use(page)
  },
})

// Wait until the map stops moving. Several specs click a map feature by pixel
// position (canvas points have no DOM node to target), which silently misses
// while snapToLatestPoints()'s fitBounds is still animating — the marker is not
// yet under the coordinate being clicked. The retry loops those tests use then
// spin for the full 30 s timeout. Poll the existing __mapCenter/__mapZoom hooks
// until two consecutive samples agree, so a click only happens once the view
// has settled.
export async function mapSettled(page) {
  await page.waitForFunction(() => {
    if (!window.__mapCenter || !window.__mapZoom) return false
    const c = window.__mapCenter()
    const key = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}@${window.__mapZoom()}`
    const prev = window.__settleKey
    window.__settleKey = key
    return prev === key
  }, undefined, { timeout: 10000 })
}

// Open a picker popover without racing the app's boot. #hp-toggle/#sp-toggle are
// static markup in index.html, so they are clickable the instant the document
// parses — while map.js is still evaluating and wirePopover() has not attached
// its click listener yet. Playwright's actionability checks all pass, the click
// dispatches into a button with no handler, and it is silently dropped: the panel
// never opens and nothing later re-opens it, so the test fails on a 5 s
// toBeVisible instead of on anything it meant to assert. That is the same
// boot-window drop as #270, and it is load-dependent — it only surfaces in a full
// parallel run, where module evaluation is slow enough to lose the race.
//
// Retrying the click is what makes this timing-independent; waiting on a readiness
// hook would only move the guess. The panel state is checked before each attempt,
// so an attempt that did land is never toggled back shut.
export function openPicker(page, toggleSel, panelSel) {
  return clickUntil(page, toggleSel, () => page.locator(panelSel).isVisible())
}

// The general form of the same problem: any control whose handler is attached
// by map.js during module evaluation can swallow a click that arrives first —
// the Locate button and the time-range toggle are static markup too.
// clickUntil retries until the effect the caller is waiting for has actually
// happened, so the test depends on the outcome rather than on the timing.
//
// `isDone` MUST be something the click handler does SYNCHRONOUSLY — a panel
// un-hidden, a class added. It is checked before each attempt, so a landed
// click is never undone by a retry; but with a condition that only becomes
// true after a fetch (Locate's #locate-info, written by drawLocate() after
// /api/points resolves) the retry would fire while the first click is still
// in flight and toggle the control straight back off.
export async function clickUntil(page, selector, isDone) {
  await expect(async () => {
    if (!(await isDone())) await page.click(selector)
    expect(await isDone()).toBe(true)
  }).toPass({ timeout: 15000 })
}

export { expect }
