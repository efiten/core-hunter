import { test, expect, openFilters, closeFilters, setFilter } from './fixtures.js'

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

test('the controls are behind the pill at every width (#539)', async ({ page }) => {
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

  // Desktop is no longer different (#539): the pill stays, the panel stays.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('#filter-pill')).toBeVisible()
  await expect(chips).toBeHidden()
  await page.click('#filter-pill')
  await expect(chips).toBeVisible()
  await expect(clear).toBeVisible()
})

// The controls are restyled, never moved. If a future change re-parents them
// at open time, the panel's contents position against boxes that are no
// longer where they were measured (#372, #385) -- so pin the parent, which is
// the thing that must not change.
test('the panel does not re-parent anything out of the bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await page.click('#filter-pill')
  const inBar = await page.evaluate(() =>
    ['f-types', 'f-direct', 'layer-seg', 'cs-adverts', 'cs-relays', 'f-nodepos', 'clear-filters']
      .every((id) => !!document.getElementById(id)?.closest('#bar')))
  expect(inBar, 'a control left #bar').toBe(true)
})

test('the pill counts what is narrowed behind it (#539)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  const count = page.locator('#filter-pill-count')
  await expect(count).toBeHidden()

  await page.click('#filter-pill')
  await page.check('#f-direct')
  await expect(count).toHaveText(' (1)')
  await expect(page.locator('#filter-pill')).toHaveClass(/has-selection/)

  // Dimensions, not chips: two active type chips are one narrowed dimension.
  // The first two chips, not named ones: below 640px the inactive tail is
  // capped away, and the front of the list is what is always on screen.
  await page.click('#f-types .f-chip >> nth=0')
  await page.click('#f-types .f-chip >> nth=1')
  await expect(count).toHaveText(' (2)')
  await expect(page.locator('#bf-types-count')).toContainText('2 of')

  // The clear button promises the same number the pill shows.
  await expect(page.locator('#clear-filters')).toHaveText('Clear 2 filters')

  await page.uncheck('#f-direct')
  await page.click('#f-types .f-chip >> nth=0')
  await page.click('#f-types .f-chip >> nth=1')
  await expect(count).toBeHidden()
  await expect(page.locator('#filter-pill')).not.toHaveClass(/has-selection/)

  // Every control the panel swallows, not just the one this branch was written
  // against (#497 landed Sender unknown while the sheet branch was open).
  await page.check('#f-unnamed')
  await expect(count).toHaveText(' (1)')

  await page.uncheck('#f-unnamed')
  await expect(count).toBeHidden()
})

// #590: the open panel was painted under the Locate readout and the
// node-position notice. #bar-filters.bf-open carries z-index 700, but it is a
// child of #bar, a fixed element at 630 and so a stacking context: against the
// rest of the page the panel is at 630, and the two corner cards were body
// children at 650. A stacking-context rule, so only the browser can pin it:
// elementFromPoint at the panel's foot, and a click Playwright only lands on
// an element that receives pointer events.
test('an open panel paints over the Locate readout and the node-position notice on a phone (#590)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ status: 503, json: { error: 'registry_unavailable' } }))
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('#nodepos-key')).toContainText('Node registry unreachable', { timeout: 10000 })
  await page.waitForFunction(() => typeof window.__locateRender === 'function')
  await page.evaluate(() => window.__locateRender([
    { lat: 51.000, lon: 4.000, rssi: -52 }, { lat: 51.010, lon: 4.000, rssi: -88 },
    { lat: 50.990, lon: 4.000, rssi: -90 }, { lat: 51.000, lon: 4.012, rssi: -86 },
  ], '4a'))
  await expect(page.locator('#locate-info')).toBeVisible()

  await openFilters(page)
  const foot = page.locator('#bar-filters .bf-foot')
  await foot.scrollIntoViewIfNeeded()
  // Both corners: the readout sits bottom-right, the notice bottom-left, and
  // the foot spans the panel's width, so each end of it lands under one card.
  const under = await page.evaluate(() => {
    const r = document.querySelector('#bar-filters .bf-foot').getBoundingClientRect()
    const panel = document.getElementById('bar-filters')
    return [r.x + 12, r.x + r.width / 2, r.right - 12].map((x) => {
      const el = document.elementFromPoint(x, r.y + r.height / 2)
      return el ? (panel.contains(el) ? 'panel' : el.id || el.className) : 'nothing'
    })
  })
  expect(under, 'what is painted at the foot of the open panel').toEqual(['panel', 'panel', 'panel'])

  // The cards are still there once the panel is shut.
  await closeFilters(page)
  await expect(page.locator('#locate-info')).toBeVisible()
  await expect(page.locator('#nodepos-key')).toBeVisible()

  // Tappable: Playwright refuses a click on a covered element. Last, since
  // Clear ends Locate and drops the layer, and with them both cards.
  await openFilters(page)
  await foot.scrollIntoViewIfNeeded()
  await page.click('#clear-filters', { timeout: 3000 })
  await expect(page.locator('#f-nodepos')).not.toBeChecked()
})
