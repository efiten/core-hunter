import { test, expect, mapSettled, clickMapAt } from './fixtures.js'

// #549: a node's reach is the star of its direct hearings, from the registry's
// advertised position when there is one and the RSSI estimate otherwise, one
// line per hearing in that hearing's tier colour. On for a picked node, and
// toggled from a popup for any node heard.
const NODE = 'aa'.repeat(32)
const hearings = [0, 1, 2, 3, 4, 5].map((i) => ({
  lat: 51 + Math.sin(i) * 0.004, lon: 4 + Math.cos(i) * 0.006, rssi: -60 - i * 9, snr: 5,
  sender_id: NODE, sender_kind: 'advert_pubkey', sender_label: 'Repeater-Zuid', hunter_name: 'Hunter 1', packet_type: 'Advert', rx_at: '2026-09-06T10:00:00Z',
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [] } }))
})

test('a picked node draws its star from the advertised position, one line per hearing', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: hearings } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { pubkey: NODE, name: 'Repeater-Zuid', ambiguous: false, lat: 51.0005, lon: 4.0005 } }))
  await page.goto('/?mode=points&senders=' + encodeURIComponent(JSON.stringify([NODE])))
  await expect.poll(() => page.evaluate(() => window.__featureCount && window.__featureCount('reach')), { timeout: 10000 }).toBe(6)
  await expect(page.locator('.rc-hub.rc-advertised')).toHaveCount(1)
  await expect(page.locator('.rc-hub')).toHaveAttribute('title', /lower bound/)
})

test('without a registry position the star hangs from the RSSI estimate, marked as such', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: hearings } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { pubkey: NODE, name: 'Repeater-Zuid', ambiguous: false } }))
  await page.goto('/?mode=points&senders=' + encodeURIComponent(JSON.stringify([NODE])))
  await expect.poll(() => page.evaluate(() => window.__featureCount('reach')), { timeout: 10000 }).toBe(6)
  await expect(page.locator('.rc-hub.rc-estimate')).toHaveCount(1)
})

test('"Show reach" in a point popup toggles the star for a node that is not picked', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: hearings } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { pubkey: NODE, name: 'Repeater-Zuid', ambiguous: false, lat: 51.0005, lon: 4.0005 } }))
  await page.goto('/?mode=points&lat=51&lon=4&z=15')
  await mapSettled(page)
  expect(await page.evaluate(() => window.__featureCount('reach'))).toBe(0)
  await expect(async () => {
    await clickMapAt(page, hearings[0].lat, hearings[0].lon)
    await expect(page.locator('.rc-toggle')).toHaveText('Show reach', { timeout: 1000 })
  }).toPass()
  await page.locator('.rc-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__featureCount('reach')), { timeout: 10000 }).toBe(6)
  expect(await page.evaluate(() => window.__reachIds())).toEqual([NODE])
  // Opening the popup again offers the way back, and it clears the star.
  await expect(async () => {
    await clickMapAt(page, hearings[0].lat, hearings[0].lon)
    await expect(page.locator('.rc-toggle')).toHaveText('Hide reach', { timeout: 1000 })
  }).toPass()
  await page.locator('.rc-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__featureCount('reach'))).toBe(0)
})
