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

export const test = base.extend({
  page: async ({ page }, use) => {
    for (const pattern of BLOCKED) await page.route(pattern, (r) => r.abort())
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

export { expect }
