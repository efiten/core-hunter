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
    // The first-run onboarding tour (#316) is a scrim over the map: it would
    // swallow every map click in every other spec. Mark it seen by default —
    // onboarding.spec.js clears storage in its own init script, which runs
    // after this one, so the tour is still exercised where it is the subject.
    await page.addInitScript(() => {
      try { localStorage.setItem('ch-onboarding-seen', '1') } catch (_) {}
    })
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

// openSettings opens the settings sheet (#420) and, optionally, one of its
// tabs. Both steps go through clickUntil for the same reason openPicker does:
// #settings-btn is static markup, clickable the moment the document parses,
// while settingssheet.js is still evaluating.
//
// Which tab an open lands on is decided by initialSettingsTab, so a spec that
// seeds an unread acknowledgement gets 'whatsnew' whether it asked or not. A
// fresh context has no acknowledgement, records the running version silently,
// and therefore always opens on Settings.
export async function openSettings(page, tab = 'settings') {
  await clickUntil(page, '#settings-btn', () => page.locator('#settings-modal').isVisible())
  if (tab) await clickUntil(page, `#ss-tab-${tab}`, () => page.locator(`#ss-panel-${tab}`).isVisible())
}

// setFilter toggles one of the secondary filters, at any width.
//
// Since #423 those controls live behind the Filters pill below 640px, so a
// phone-width test has to open it the way a user does; above the breakpoint the
// pill is not rendered and this is a plain check(). The panel is shut again
// afterwards because it overlays the map, and most callers go on to assert
// something about what the map is showing.
export async function setFilter(page, selector, on = true) {
  const pill = page.locator('#filter-pill')
  const mobile = await pill.isVisible()
  if (mobile) await pill.click()
  if (on) await page.check(selector)
  else await page.uncheck(selector)
  if (mobile) await page.keyboard.press('Escape')
}

// The filter panel (#539): everything that narrows the view lives behind the
// Filters pill at every width. These are the one way a test drives those
// controls, so a change to the panel's mechanics lands here once.
export async function openFilters(page) {
  const panel = page.locator('#bar-filters')
  if (await panel.evaluate((el) => el.classList.contains('bf-open'))) return
  await clickUntil(page, '#filter-pill', () => panel.evaluate((el) => el.classList.contains('bf-open')))
}

export async function closeFilters(page) {
  const panel = page.locator('#bar-filters')
  if (!(await panel.evaluate((el) => el.classList.contains('bf-open')))) return
  await page.keyboard.press('Escape')
}

// The typed prefix search moved off the bar into the panel's Sender id group
// (#561), so a test drives it the way a reader does: open Filters, type, close.
// `close` is opt-out for the specs that go on to read the field back.
export async function fillSender(page, value, { close = true } = {}) {
  await openFilters(page)
  await page.fill('#f-sender', value)
  if (close) await closeFilters(page)
}

// Same move for the ignore picker (#561/#564): the bar carried it, the panel
// owns it now. Returns with the picker open and the panel behind it.
export async function openIgnorePicker(page) {
  await openFilters(page)
  await openPicker(page, '#ig-toggle', '#ignore-picker')
}

// Clicks one of the panel's chips (type or id-class) by its data attribute.
export async function clickPanelChip(page, selector) {
  await openFilters(page)
  await page.click(selector)
  await closeFilters(page)
}

// Sets the layer mode via the segmented control in the panel.
export async function setLayerMode(page, mode) {
  await openFilters(page)
  await page.click(`#lm-${mode}`)
  await closeFilters(page)
}

// Locate and Clear live in the panel too (#539).
export async function clickLocate(page) {
  await openFilters(page)
  await page.click('#locate-toggle')
  await closeFilters(page)
}

export async function clickClearFilters(page) {
  await openFilters(page)
  await page.click('#clear-filters')
  await closeFilters(page)
}

// Toggles Locate via the panel and leaves the panel shut. The .on class is
// asserted by count, not visibility: the button is only visible while the
// panel is open.
export async function toggleLocate(page, expectOn = true) {
  await openFilters(page)
  await clickUntil(page, '#locate-toggle', async () => (await page.locator('#locate-toggle.on').count()) === (expectOn ? 1 : 0))
  await closeFilters(page)
}
