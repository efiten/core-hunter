import { test, expect, openPicker, openFilters } from './fixtures.js'

// #372: on a phone #bar wrapped, #tr-toggle started its own row, and the
// right-anchored time-range panel grew off the left edge — what showed was its
// own padding, so the control read as an empty dark box. These assert the
// contents are reachable, not merely that the panel element is visible, which
// was true the whole time it was broken.
// The bar stopped wrapping in #561 and these controls moved into the filter
// panel at phone width, so the popovers now open from inside a sheet. That is a
// different box to overflow, and the same assertion still has to hold.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

// Every part of a popover has to be inside the viewport, not just its box.
async function expectOnScreen(page, selector) {
  const vp = page.viewportSize()
  const box = await page.locator(selector).boundingBox()
  expect(box, `${selector} has a box`).not.toBeNull()
  expect(box.x, `${selector} left edge`).toBeGreaterThanOrEqual(0)
  expect(box.y, `${selector} top edge`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `${selector} right edge`).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height, `${selector} bottom edge`).toBeLessThanOrEqual(vp.height)
}

// Below 640px the time range and the hunter picker are reached through Filters
// (#561): the bar's group keeps Select target and the pill at that width, and
// the other two live in the panel. Which is where the popovers have to open
// fully on screen from now -- the constraint #372 named has not changed, only
// the box it is measured from.
const reach = async (page, toggle, panel, narrow) => {
  if (narrow && ['#tr-toggle', '#hp-toggle'].includes(toggle)) await openFilters(page)
  await openPicker(page, toggle, panel)
}

for (const [label, width, height] of [['a phone', 412, 915], ['a desktop', 1280, 720]]) {
  const narrow = width <= 640
  test(`the time-range picker opens fully on screen on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await reach(page, '#tr-toggle', '#time-picker', narrow)
    // The panel itself, then each thing #372 says you cannot reach.
    await expectOnScreen(page, '#time-picker')
    for (const sel of ['#tr-from', '#tr-to', '#tr-apply', '#tr-copy', '#tr-quick']) {
      await expect(page.locator(sel)).toBeVisible()
      await expectOnScreen(page, sel)
    }
    // Reachable, not just on screen: a quick range has to take the click.
    const first = page.locator('#tr-quick li button').first()
    await expect(first).toBeVisible()
    await first.click()
    await expect(page.locator('#time-picker')).toBeHidden()
  })

  test(`the hunter and sender pickers open fully on screen on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    for (const [toggle, panel] of [['#hp-toggle', '#hunter-picker'], ['#sp-toggle', '#sender-picker']]) {
      await reach(page, toggle, panel, narrow)
      await expectOnScreen(page, panel)
      await page.keyboard.press('Escape')
      await expect(page.locator(panel)).toBeHidden()
    }
  })
}

test('an open panel follows its toggle when a resize moves it', async ({ page }) => {
  // The bar no longer rewraps (#561), so the toggle does not change rows. What
  // it does at 640px is move house: #tr-wrap leaves the bar's group for the
  // filter panel. An open popover cannot follow it there -- the panel is shut,
  // and a popover inside a shut panel is a control that has silently vanished
  // while its toggle still claims to be expanded. It closes instead.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await openPicker(page, '#tr-toggle', '#time-picker')
  await page.setViewportSize({ width: 412, height: 915 })
  await expect(page.locator('#time-picker')).toBeHidden()
  await expect(page.locator('#tr-toggle')).toHaveAttribute('aria-expanded', 'false')
  // And it is reachable again where it now lives, still fully on screen.
  await openFilters(page)
  await openPicker(page, '#tr-toggle', '#time-picker')
  await expectOnScreen(page, '#time-picker')
  await expectOnScreen(page, '#tr-quick')
  const panel = await page.locator('#time-picker').boundingBox()
  const toggle = await page.locator('#tr-toggle').boundingBox()
  expect(panel.y, 'panel still hangs off its toggle').toBeGreaterThanOrEqual(toggle.y + toggle.height)
})

// #bar carries backdrop-filter, which per Filter Effects 2 makes it the
// containing block for its fixed-position descendants — the panels. Measured in
// this Chromium, the rule is applied for backdrop-filter as well as for filter:
// a fixed child of a filtered box at (100,50) renders at (100,50), not (0,0).
//
// placePopover writes viewport coordinates regardless, which is only safe
// because #bar's padding box starts at the viewport origin: fixed at top/left 0,
// no border, no transform. Those three are the assumption, so they are what this
// pins. If any of them changes, placePopover has to correct by the delta between
// the value it writes and the rect that results.
test('#bar is the containing block for the panels, and its frame coincides with the viewport', async ({ page }) => {
  await page.goto('/')
  const m = await page.evaluate(() => {
    const bar = document.getElementById('bar')
    const cs = getComputedStyle(bar)
    const r = bar.getBoundingClientRect()
    // Does the containing-block rule apply in this engine at all?
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:100px;top:50px;width:200px;height:200px;backdrop-filter:blur(8px)'
    const child = document.createElement('div')
    child.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px'
    host.appendChild(child); document.body.appendChild(host)
    const c = child.getBoundingClientRect()
    host.remove()
    return {
      ruleApplies: c.left === 100 && c.top === 50,
      backdrop: cs.backdropFilter,
      origin: [r.left, r.top],
      border: [cs.borderLeftWidth, cs.borderTopWidth],
      transform: cs.transform,
    }
  })
  expect(m.backdrop, '#bar still carries a backdrop-filter').not.toBe('none')
  expect(m.ruleApplies, 'a backdrop-filtered box is the containing block for fixed children').toBe(true)
  expect(m.origin, "#bar's box starts at the viewport origin").toEqual([0, 0])
  expect(m.border, '#bar has no border to offset its padding box').toEqual(['0px', '0px'])
  expect(m.transform, '#bar is untransformed').toBe('none')
})
