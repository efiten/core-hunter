import { test, expect, openPicker } from './fixtures.js'

// #386: #bar is flex-wrap and keeps growing after load — the packet chips
// render, the role notice arrives with /api/auth/me, the node counts and the
// server version land later — while setMapTop() measured it once at module
// load. #rx-log (z-index 620) then sits over the bar's last row (z-index 600)
// and takes the clicks meant for #ch-version, the what's-new opener.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  // Arrives after first paint and widens the version button, one of the things
  // that wraps the bar into another row.
  await page.route('**/api/version', (r) => r.fulfill({ json: { server: '9.9.9' } }))
})

const layout = (page) => page.evaluate(() => {
  const bar = document.getElementById('bar').getBoundingClientRect()
  const rx = document.getElementById('rx-log').getBoundingClientRect()
  const btn = document.getElementById('ch-version').getBoundingClientRect()
  const top = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2)
  return {
    barBottom: bar.bottom,
    rxTop: rx.top,
    mapTop: document.getElementById('map').getBoundingClientRect().top,
    // The button, or its own text span: both count as reaching the control.
    atButtonCentre: top ? (top.id || top.className || top.tagName) : null,
  }
})

for (const [w, h] of [[1280, 720], [1280, 800]]) {
  test(`the receptions ticker stays clear of the bar at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    // Wait for the late content that grows the bar, then assert: the bug is a
    // stale measurement, so it only shows once the bar has outgrown it.
    await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
    const l = await layout(page)
    expect(l.rxTop, '#rx-log starts below #bar').toBeGreaterThanOrEqual(l.barBottom)
    expect(l.atButtonCentre, 'the version button is the top element at its own centre')
      .toMatch(/ch-version/)
    // #map is NOT asserted here: it stays on its pre-setView measurement on
    // purpose, because re-running invalidateSize after the initial view walks
    // the centre off the neutral world view (#218). The bar paints above it.
  })

  test(`the version button opens the what's-new panel at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
    // No force, no clickUntil: an unforced click that lands is the whole point.
    // Under the bug this times out, because .rx-hd intercepts the pointer.
    await page.locator('#ch-version').click({ timeout: 5000 })
    await expect(page.locator('#whatsnew-modal')).toBeVisible()
  })
}

// #322 widened the ticker into a full-width band, and .rx-ln takes pointer
// events, so the bar's own popovers — DOM children of #bar, painting in its
// stacking context — started losing clicks to it. Measured at 1280x720: the
// sender picker's second row sat under the first ticker row and
// elementFromPoint returned .rx-ln. Font-metric dependent, which is why it
// reproduced locally and not on CI's fonts, so this asserts the ordering
// itself as well as the click.
const TICK = {
  lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'aa11bb22', sender_label: 'NEO7HI',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', packet_type: 'Advert', rx_at: '2026-07-22T14:59:55Z',
}

test('a bar popover stays clickable over a populated ticker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.route('**/api/points*', (r) => r.fulfill({
    json: { points: [TICK, { ...TICK, sender_id: 'cc33dd44', sender_label: 'Charlie', rx_at: '2026-07-22T14:59:58Z' }] },
  }))
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#rx-log .rx-ln').first()).toBeVisible()

  // Every row, not just the first: the overlap only reaches the ones far
  // enough down the panel to meet the ticker's playhead lane.
  const rows = page.locator('#tp-list .tl-row')
  for (let i = 0; i < await rows.count(); i++) {
    const hit = await rows.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return at ? at.closest('.tl-row') !== null : false
    })
    expect(hit, `picker row ${i} is the top element at its own centre`).toBe(true)
  }
  // And an unforced click lands, which is what the user does.
  await rows.nth(1).click({ timeout: 5000 })
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
})

test('the bar paints above the ticker, which is what keeps its popovers usable', async ({ page }) => {
  await page.goto('/')
  const z = await page.evaluate(() => ({
    bar: Number(getComputedStyle(document.getElementById('bar')).zIndex),
    rx: Number(getComputedStyle(document.getElementById('rx-log')).zIndex),
  }))
  expect(z.bar).toBeGreaterThan(z.rx)
})
