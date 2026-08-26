import { test, expect } from './fixtures.js'

// #423: web/style.css had no @media rule, so #bar wrapped ~20 controls into six
// rows on a phone and took roughly 45% of the viewport before the map got any.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

const geometry = (page) => page.evaluate(() => {
  const bar = document.getElementById('bar').getBoundingClientRect()
  const map = document.getElementById('map').getBoundingClientRect()
  return { barH: Math.round(bar.height), vh: window.innerHeight, mapTop: Math.round(map.top),
    mapShare: +((window.innerHeight - map.top) / window.innerHeight).toFixed(2) }
})

test('on a phone the map keeps most of the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await expect(page.locator('#filter-pill')).toBeVisible()

  const g = await geometry(page)
  // The number #423 is about. 45% was the measured before; "most of the
  // viewport" is the stated expectation, so this is the line that has to hold.
  expect(g.mapShare, `map got ${g.mapShare * 100}% of ${g.vh}px, bar is ${g.barH}px`).toBeGreaterThan(0.75)
})

test('the secondary controls are behind the pill, and come back on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  const chips = page.locator('#f-types')
  const clear = page.locator('#clear-filters')
  await expect(chips).toBeHidden()
  await expect(clear).toBeHidden()

  await page.click('#filter-pill')
  await expect(page.locator('#bar-filters')).toHaveClass(/bf-open/)
  await expect(chips).toBeVisible()
  await expect(clear).toBeVisible()
  await expect(page.locator('#filter-pill')).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(chips).toBeHidden()

  // Above the breakpoint nothing changes: the pill goes away and every control
  // is inline in the bar again, without the sheet class being cleared first.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('#filter-pill')).toBeHidden()
  await expect(chips).toBeVisible()
  await expect(clear).toBeVisible()
})

// The controls are restyled, never moved. If a future change re-parents them
// into the sheet, the bar's pickers position against a toggle that is no longer
// where placePopover thinks it is (#372, #385) -- so pin the parent, which is
// the thing that must not change.
test('the sheet does not re-parent anything out of the bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await page.click('#filter-pill')
  const inBar = await page.evaluate(() =>
    ['f-types', 'f-direct', 'layer-toggle', 'cs-adverts', 'cs-relays', 'f-nodepos', 'clear-filters']
      .every((id) => !!document.getElementById(id)?.closest('#bar')))
  expect(inBar, 'a control left #bar').toBe(true)
})

test('the pill says when something behind it is filtered', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  const dot = page.locator('#filter-pill-dot')
  await expect(dot).toBeHidden()

  await page.click('#filter-pill')
  await page.check('#f-direct')
  await expect(dot).toBeVisible()

  await page.uncheck('#f-direct')
  await expect(dot).toBeHidden()

  // Every control the sheet swallows, not just the one this branch was written
  // against. Sender unknown arrived in the bar from #497 while this was open,
  // so on a phone it is filtered behind the pill from the day it lands.
  await page.check('#f-unnamed')
  await expect(dot).toBeVisible()

  await page.uncheck('#f-unnamed')
  await expect(dot).toBeHidden()
})
