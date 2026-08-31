import { test, expect } from './fixtures.js'

// #424: the ticker was a full-width band across the middle-top of the map, over
// the content, colliding with Leaflet's zoom control, with no way to put it
// away. It is now a placed box the user drags, and it folds.

// Twelve, not one: since #424 the card's height follows how much it holds, so
// a single reception is a one-lane card with only the header-alone stop left
// to reach. Twelve is past the last step, which is what makes every stop
// reachable and the placement measurements stable.
const RX = Array.from({ length: 12 }, (_, i) => ({
  lat: 51, lon: 4, rssi: -70 - i, snr: -3, sender_id: 'aa'.repeat(32), sender_kind: 'advert_pubkey',
  sender_label: 'NODE-' + i, hunter_name: 'H', packet_type: 'Advert',
  rx_at: new Date(Date.parse('2026-08-24T10:00:00Z') + i * 1000).toISOString(),
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: RX } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

const box = (page) => page.evaluate(() => {
  const r = document.getElementById('rx-log').getBoundingClientRect()
  const bar = document.getElementById('bar').getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), right: Math.round(r.right),
    vw: innerWidth, vh: innerHeight, barBottom: Math.round(bar.bottom) }
})

test('starts in the top right, clear of the zoom control and the centre', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const b = await box(page)
  // The two things the issue names: not spanning the map, and not at the left
  // where Leaflet's zoom control lives.
  expect(b.w).toBeLessThan(b.vw)
  // Right-anchored: its RIGHT edge hugs the viewport. Asserting the left edge
  // is past the midpoint would be wrong -- a 680px box on a 1280px screen
  // starts at 588 however hard it is pushed right.
  expect(b.right).toBeLessThanOrEqual(b.vw)
  expect(b.vw - b.right, 'not anchored to the right edge').toBeLessThanOrEqual(16)
  // And clear of the left, where Leaflet's zoom control lives -- the collision
  // the issue names.
  expect(b.x, 'still overlapping the zoom control').toBeGreaterThan(100)
  expect(b.y).toBeGreaterThanOrEqual(b.barBottom)
})

test('drags by its frame and remembers where it was left', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const before = await box(page)

  const strip = page.locator('.rx-grab-t')
  const s = await strip.boundingBox()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(300, 400, { steps: 10 })
  await page.mouse.up()

  const after = await box(page)
  expect(after.x, `did not move from ${before.x}`).not.toBe(before.x)

  // Persisted like the other view state: a reload puts it back where it was.
  await page.reload()
  const reloaded = await box(page)
  expect(Math.abs(reloaded.x - after.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(reloaded.y - after.y)).toBeLessThanOrEqual(2)
})

test('a ticker left at the edge of a wide screen is still reachable on a narrow one', async ({ page }) => {
  // The safety net the issue asks for: dragging replaces the anchor, so there
  // is no "put it back" and an off-screen ticker would be lost for good.
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/')
  const strip = page.locator('.rx-grab-t')
  const s = await strip.boundingBox()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(1380, 860, { steps: 8 })
  await page.mouse.up()

  await page.setViewportSize({ width: 480, height: 700 })
  // Polled: the clamp runs from the resize handler, so asserting on the first
  // measurement races it. Polling also proves it actually settles rather than
  // happening to be right at one instant.
  await expect.poll(async () => (await box(page)).x, { timeout: 5000 }).toBeLessThanOrEqual(480)
  const b = await box(page)
  expect(b.x).toBeGreaterThanOrEqual(0)
  expect(b.right, 'stranded off the right edge').toBeLessThanOrEqual(b.vw)
  expect(b.y).toBeLessThanOrEqual(b.vh)
  expect(b.y).toBeGreaterThanOrEqual(b.barBottom - 1)
})

// A height-only resize does not change the bar's size, so the bar's
// ResizeObserver never fires and the window resize listener is the only thing
// that reflows. Worth its own case: without it, deleting that listener leaves
// every other test green while a shortened window strands the ticker below the
// fold for good.
test('a shorter window pulls the ticker back into view', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto('/')
  const strip = page.locator('.rx-grab-t')
  const s = await strip.boundingBox()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move(400, 820, { steps: 8 })
  await page.mouse.up()
  expect((await box(page)).y).toBeGreaterThan(600)

  // Same width, so the bar is untouched and only `resize` can save it.
  await page.setViewportSize({ width: 1000, height: 420 })
  await expect.poll(async () => (await box(page)).y, { timeout: 5000 }).toBeLessThanOrEqual(420)
  const b = await box(page)
  expect(b.y).toBeGreaterThanOrEqual(b.barBottom - 1)
})

// One control, several stops since #424: full, three lanes, one, then the
// header alone. How many of those exist depends on how much traffic the ticker
// is holding, because a stop that would not make the card smaller is skipped
// (it would swallow a click). So the test walks the cycle rather than assuming
// its length: every click shrinks the card or hides the list, and one more
// after that is back to where it started.
test('shrinks a step at a time, and the cross puts it away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const list = page.locator('#rx-list')
  const fold = page.locator('.rx-fold')
  await expect(list).toBeVisible()
  await expect(fold).toHaveAttribute('aria-expanded', 'true')

  const height = () => page.evaluate(() => document.getElementById('rx-list').getBoundingClientRect().height)
  const full = await height()
  expect(full).toBeGreaterThan(0)

  // How many stops exist depends on how much the ticker holds, because one
  // that would not make the card smaller is skipped rather than swallowing a
  // click. So walk it rather than assuming a length.
  let previous = full
  let clicks = 0
  while (clicks < 2) {
    await fold.click()
    clicks++
    const now = await height()
    expect(now, `click ${clicks} made the card smaller`).toBeLessThan(previous)
    previous = now
  }
  // Never to nothing: putting it away is the cross, not a further stop.
  expect(previous).toBeGreaterThan(0)
  await expect(fold).toHaveAttribute('aria-expanded', 'false')

  // One more is back to full.
  await fold.click()
  expect(await height()).toBe(full)
})

test('the cross puts the ticker away, and the bar brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const card = page.locator('#rx-log')
  const barBtn = page.locator('#ticker-btn')
  await expect(card).toBeVisible()
  await expect(barBtn).toBeHidden()

  await page.locator('.rx-close').click()
  await expect(card).toBeHidden()
  await expect(barBtn).toBeVisible()

  // And it stays away across a reload, like every other view setting.
  await page.reload()
  await expect(page.locator('#rx-log')).toBeHidden()
  await expect(page.locator('#ticker-btn')).toBeVisible()

  await page.locator('#ticker-btn').click()
  await expect(page.locator('#rx-log')).toBeVisible()
  await expect(page.locator('#ticker-btn')).toBeHidden()
})

test('starts at its smallest on a phone, where the card is what covers the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  // Small, not away: a ticker nobody can see is a different thing from a
  // one-line one, and the point of the per-surface default is only that it
  // should not cover the map.
  await expect(page.locator('#rx-log')).toBeVisible()
  const h = await page.evaluate(() => document.getElementById('rx-list').getBoundingClientRect().height)
  const line = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ch-rx-line-h')))
  expect(Math.round(h / line)).toBe(1)
})

// #322 made the band frameless on purpose and #287/#322 keep pointer-events off
// it so drags and wheels reach Leaflet. The frame must not undo either.
test('the frame is invisible at rest and never covers the map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const m = await page.evaluate(() => {
    const log = document.getElementById('rx-log')
    const grab = log.querySelector('.rx-grab')
    const r = log.getBoundingClientRect()
    // Two samples, and the edges are the ones that matter. The strips sit 6px
    // OUTSIDE the band, over the map, so sampling only the middle misses them
    // entirely -- which is how an invisible strip that swallowed clicks on a
    // Leaflet popup's button got past this test the first time.
    const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.bottom - 8))
    const strips = [...log.querySelectorAll('.rx-grab-t, .rx-grab-l')].map((el) => {
      const s = el.getBoundingClientRect()
      return { outsideLeft: s.left < r.left - 0.5, outsideTop: s.top < r.top - 0.5,
        outsideRight: s.right > r.right + 0.5 }
    })
    return { grabOpacity: getComputedStyle(grab).opacity,
      logEvents: getComputedStyle(log).pointerEvents,
      midIsTicker: !!(mid && mid.closest('#rx-log')),
      strips }
  })
  expect(m.grabOpacity).toBe('0')
  expect(m.logEvents).toBe('none')
  expect(m.midIsTicker, 'the band is swallowing pointer events over the map').toBe(false)
  // The strips ARE hit-testable at rest -- they have to be, or the frame can
  // only be grabbed by first crossing the text. What they must not do is reach
  // outside the band, where they would take clicks from the map: that is the
  // bug that broke ui.spec's "Locate this sender" popup button.
  for (const s of m.strips) {
    expect(s.outsideLeft, 'a drag strip reaches left of the band, over the map').toBe(false)
    expect(s.outsideTop, 'a drag strip reaches above the band, over the map').toBe(false)
    expect(s.outsideRight, 'a drag strip reaches right of the band, over the map').toBe(false)
  }
})
