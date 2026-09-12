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

// #405: the bar watcher took over from the panels' window.resize listeners,
// and a window that only changes height moves neither the bar nor a control
// in it. The panel is placed against the viewport all the same, so it has to
// be placed again. Measured without that: the phone's time picker kept its
// 616px bottom edge in a 520px window.
test('an open panel is placed again when only the window height changes', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  // The status line lands late and moves the controls after it, which places
  // the panel again whatever the window did. Wait for it before opening.
  // The resize still moves the map, and the refresh that follows rewrites
  // #status without moving a control. That mutation asks for a check too, so
  // what this test pins is the window's size in the compared signature. That
  // the window's resize event asks for a check is pinned in barwatch.test.js.
  await expect(page.locator('#status')).not.toBeEmpty()
  // #tr-toggle is in the filter panel at this width (#561), and hidden until
  // the panel is open, so the picker is reached through Filters first.
  await openFilters(page)
  await openPicker(page, '#tr-toggle', '#time-picker')
  await page.setViewportSize({ width: 412, height: 520 })
  await expect(async () => expectOnScreen(page, '#time-picker')).toPass({ timeout: 5000 })
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

// #405: window.resize never fires for content that grows the bar after load
// (the node counts, the version), so a panel opened before that landed stayed
// where its toggle had been. The one bar watcher sees the growth.
//
// Simulated by inserting a block at the bar's start, which pushes every
// control after it along the row. It used to be a full-width block pushing
// them onto a new row, which #572 made impossible: the bar is one row with
// flex-wrap: nowrap, and that is load-bearing (a bar that grows after #map's
// top is measured hides the map under it). What remains is the same fault in
// the direction the bar can still move in, and it is what the real arrivals
// do: measured at 1280 as a guest, the controls settle 145px sideways between
// first paint and the last arrival, and at 768 the bar's own height goes from
// 49 to 68px.
for (const [toggle, panel] of [['#tr-toggle', '#time-picker'], ['#hp-toggle', '#hunter-picker']]) {
  test(`an open ${panel} follows its toggle when late content grows the bar (#405)`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await openPicker(page, toggle, panel)
    const before = await page.locator(toggle).boundingBox()
    await page.evaluate(() => {
      const grow = document.createElement('div')
      grow.id = 'e2e-grow'; grow.style.cssText = 'flex:0 0 420px;height:40px'
      document.getElementById('bar').prepend(grow)
    })
    // The toggle moved along the row: the panel has to hang off where it is
    // now. Only the vertical relation is pinned, as before -- placePopover
    // clamps a panel wider than the room to its right, so its left edge is
    // not the toggle's once the toggle is near the far side (#372, #385).
    await expect.poll(async () => (await page.locator(toggle).boundingBox()).x).toBeGreaterThan(before.x + 300)
    await expect.poll(async () => {
      const p = await page.locator(panel).boundingBox()
      const t = await page.locator(toggle).boundingBox()
      return p.y >= t.y + t.height
    }, { message: 'panel below its moved toggle' }).toBe(true)
    await expectOnScreen(page, panel)
  })
}
