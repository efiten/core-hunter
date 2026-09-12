import { test, expect, openFilters, closeFilters } from './fixtures.js'

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
  // nth=1 and nth=2, not 0 and 1: the All chip is the first child since #564,
  // and clicking it is how you clear the row rather than narrow it. Still the
  // front of the list, which is what stays on screen under the +N cap.
  await page.click('#f-types .f-chip >> nth=1')
  await page.click('#f-types .f-chip >> nth=2')
  await expect(count).toHaveText(' (2)')
  await expect(page.locator('#bf-types-count')).toContainText('2 of')
  // Of the packet types, not of the chips: the All chip is a child of the row
  // but is not a type (#564), and the app's row says the same number.
  await expect(page.locator('#bf-types-count')).toHaveText('2 of 14')
  // One vocabulary with the app and with the Clear button below it.
  await expect(page.locator('#bf-count')).toHaveText('2 filters')

  // The clear button promises the same number the pill shows.
  await expect(page.locator('#clear-filters')).toHaveText('Clear 2 filters')

  await page.uncheck('#f-direct')
  await page.click('#f-types .f-chip >> nth=1')
  await page.click('#f-types .f-chip >> nth=2')
  await expect(count).toBeHidden()
  await expect(page.locator('#filter-pill')).not.toHaveClass(/has-selection/)
})

// #564: "everything" used to be written as no chip lit, which is correct in the
// query the row builds and says nothing at all on screen. It is an explicit All
// chip now, on both surfaces, and the empty selection IS that chip.
test('the All chip is how the row says "everything"', async ({ page }) => {
  await page.goto('/')
  await openFilters(page)
  const row = page.locator('#f-types')
  const all = row.locator('.f-chip[data-type="all"]')
  const advert = row.locator('.f-chip[data-type="Advert"]')

  await expect(all, 'a fresh row opens on All').toHaveClass(/active/)
  await expect(row.locator('.f-chip.active')).toHaveCount(1)

  await advert.click()
  await expect(all, 'picking a type turns All off').not.toHaveClass(/active/)
  await expect(advert).toHaveClass(/active/)

  // Unpicking the last one falls back to All, rather than to a row with nothing
  // lit — which would be the same state drawn two different ways.
  await advert.click()
  await expect(all).toHaveClass(/active/)
  await expect(row.locator('.f-chip.active')).toHaveCount(1)

  // And All clears a selection rather than adding to it.
  await advert.click()
  await row.locator('.f-chip[data-type="GroupText"]').click()
  await expect(row.locator('.f-chip.active')).toHaveCount(2)
  await all.click()
  await expect(row.locator('.f-chip.active')).toHaveCount(1)
  await expect(all).toHaveClass(/active/)
})

test('the All chip never reaches the query or the link', async ({ page }) => {
  // It is a drawing of the empty set. `types=all` would be a filter for a
  // packet type that does not exist, and the server buckets these verbatim.
  await page.goto('/')
  await openFilters(page)
  await page.locator('#f-types .f-chip[data-type="all"]').click()
  await page.locator('#f-idclass .f-chip[data-idclass="all"]').click()
  await closeFilters(page)
  await expect(page).toHaveURL((u) => !u.searchParams.has('types') && !u.searchParams.has('idclass'))
  const sent = await page.evaluate(() => ({ types: window.currentTypes(), idclass: window.currentIdClasses() }))
  expect(sent).toEqual({ types: '', idclass: '' })
})

// The cap counts types, and the All chip is a child of the same row.
test('the +N cap shows six types, not five plus All', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await openFilters(page)
  const shown = page.locator('#f-types .f-chip:visible')
  // All plus the first six types.
  await expect(shown).toHaveCount(7)
  await expect(shown.first()).toHaveAttribute('data-type', 'all')
  await page.click('#bf-types-more')
  await expect(page.locator('#f-types .f-chip:visible').first()).toHaveAttribute('data-type', 'all')
  expect(await page.locator('#f-types .f-chip:visible').count()).toBeGreaterThan(7)
})
