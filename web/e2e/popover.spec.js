import { test, expect, openPicker } from './fixtures.js'

// #372: on a phone #bar wraps, #tr-toggle starts its own row, and the
// right-anchored time-range panel grew off the left edge — what showed was its
// own padding, so the control read as an empty dark box. These assert the
// contents are reachable, not merely that the panel element is visible, which
// was true the whole time it was broken.

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

for (const [label, width, height] of [['a phone', 412, 915], ['a desktop', 1280, 720]]) {
  test(`the time-range picker opens fully on screen on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await openPicker(page, '#tr-toggle', '#time-picker')
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
      await openPicker(page, toggle, panel)
      await expectOnScreen(page, panel)
      await page.keyboard.press('Escape')
      await expect(page.locator(panel)).toBeHidden()
    }
  })
}

test('an open panel follows the toggle when a resize rewraps the bar', async ({ page }) => {
  // The bar rewraps on resize, so the toggle moves to another row. A one-shot
  // placement leaves the panel behind, pointing at nothing.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await openPicker(page, '#tr-toggle', '#time-picker')
  await page.setViewportSize({ width: 412, height: 915 })
  await expect(page.locator('#time-picker')).toBeVisible()
  await expectOnScreen(page, '#time-picker')
  await expectOnScreen(page, '#tr-quick')
  const panel = await page.locator('#time-picker').boundingBox()
  const toggle = await page.locator('#tr-toggle').boundingBox()
  expect(panel.y, 'panel still hangs off its toggle').toBeGreaterThanOrEqual(toggle.y + toggle.height)
})
