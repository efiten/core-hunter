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
// Polled, not read once: a panel is re-placed in the page's resize handler,
// and under a parallel run that can land after setViewportSize has resolved,
// so a single read saw the old placement (1 in ~3 full runs, 0 in 10 alone).
// Every edge still has to end up inside; the poll only decides when to look.
async function expectOnScreen(page, selector) {
  const vp = page.viewportSize()
  await expect.poll(async () => {
    const box = await page.locator(selector).boundingBox()
    if (!box) return 'no box'
    if (box.x < 0) return `left edge at ${box.x}`
    if (box.y < 0) return `top edge at ${box.y}`
    if (box.x + box.width > vp.width) return `right edge at ${box.x + box.width}, viewport ${vp.width}`
    if (box.y + box.height > vp.height) return `bottom edge at ${box.y + box.height}, viewport ${vp.height}`
    return 'on screen'
  }, { message: `${selector} on screen` }).toBe('on screen')
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
