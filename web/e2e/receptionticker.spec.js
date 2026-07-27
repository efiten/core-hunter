import { test, expect } from '@playwright/test'

// Reception ticker (#224) — parity with app's Receptions log (#130).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

const POINT = {
  lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'aa11bb22', sender_label: 'NEO7HI', sender_role: 'Repeater',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', channel_name: '', packet_type: 'Advert',
  rx_at: new Date(Date.now() - 5000).toISOString(),
}
// A second, distinct point (different coords/sender/time) so the sync tests
// below can prove a click moves the active line/highlight to a SPECIFIC
// reception, not just that something is active -- with only one point on
// the map, that point's line auto-activates on load regardless of whether
// the click wiring does anything at all (caught by an earlier, weaker
// version of these tests).
const POINT2 = {
  ...POINT, lat: 52, lon: 5, sender_id: 'cc33dd44', sender_label: 'OTHER',
  rx_at: new Date(Date.now() - 1000).toISOString(), // newer -> the one auto-active on load
}

test('renders a fetched reception with rssi, sender, and a count', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [POINT] } }))
  await page.goto('/?mode=points')
  // The ticker's own initial fetch races module load / other boot-time fetches
  // under worker contention (same margin issue as #273/#270) -- a generous
  // timeout here, not a retry loop, since a clean load always converges.
  await expect(page.locator('#rx-log .rx-count')).toHaveText('1 rx', { timeout: 10000 })
  const line = page.locator('#rx-log .rx-ln')
  await expect(line).toContainText('-90')
  await expect(line).toContainText('NEO7HI')
})

test('filtered/all toggle switches the mode label and refetches without sender/type/direct-only', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [POINT] } }) })
  await page.goto('/?mode=points&sender=aa11')
  await expect(page.locator('#rx-log .rx-tg b')).toHaveText('filtered')

  const before = urls.length
  await page.click('#rx-log .rx-tg')
  await expect(page.locator('#rx-log .rx-tg b')).toHaveText('all')
  // Every fetchAndRebuild() re-fetches BOTH filtered and (in 'all' mode) all --
  // filtered is still needed to annotate "no marker" rows -- so two requests
  // land after the toggle. Assert at least one omits sender=, not that the
  // first one does; which of the two resolves/logs first isn't guaranteed.
  await expect.poll(() => urls.slice(before).some((u) => u.includes('limit=200') && !u.includes('sender='))).toBe(true)
})

test('clicking a map marker scrolls the ticker to that specific line (marker -> ticker)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [POINT, POINT2] } }))
  await page.goto('/?mode=points') // fitBounds (#218) frames both points
  await expect(page.locator('#rx-log .rx-ln')).toHaveCount(2, { timeout: 10000 })
  // POINT2 is newer -> auto-active on load (follow=true scrolls to newest).
  await expect(page.locator('#rx-log .rx-ln.act')).toContainText('OTHER')

  await expect(async () => {
    const { x, y } = await page.evaluate(() => window.__mapProject(51, 4)) // POINT's coords
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + x, box.y + y)
    await expect(page.locator('#rx-log .rx-ln.act')).toContainText('NEO7HI', { timeout: 1000 })
  }).toPass()
})

test('clicking a ticker line highlights the map at that specific reception\'s position (ticker -> marker)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [POINT, POINT2] } }))
  await page.goto('/?mode=points')
  await expect(page.locator('#rx-log .rx-ln')).toHaveCount(2, { timeout: 10000 })
  // Auto-active on load is POINT2 (newest) -> highlight starts at its coords.
  await expect.poll(() => page.evaluate(() => window.__rxHighlightLatLng())).toMatchObject({ lat: 52, lng: 5 })

  await page.locator('#rx-log .rx-ln', { hasText: 'NEO7HI' }).click()
  await expect.poll(() => page.evaluate(() => window.__rxHighlightLatLng())).toMatchObject({ lat: 51, lng: 4 })
})
