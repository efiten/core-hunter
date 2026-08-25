import { test, expect } from './fixtures.js'
const flood = Array.from({ length: 60 }, (_, i) => ({
  lat: 52.36 + i * 1e-4, lon: 4.83, rssi: i < 2 ? -34 : -95, snr: -5,
  hops: 1 + (i % 12), sender_id: '', sender_kind: '', sender_label: '',
  hunter_name: 'Onnix', packet_type: 'TextMessage', rx_at: '2026-08-24T20:57:00Z',
}))
const normal = flood.map((p, i) => ({ ...p, hops: i % 3 === 0 ? 0 : 4 }))
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})
test('a flood with no zero-hop reception explains why Direct only would empty the map', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: flood } }))
  await page.goto('/?mode=points')
  const n = page.locator('#hop-notice')
  await expect(n).toBeVisible({ timeout: 10000 })
  await expect(n).toContainText('would hide every one')
  await expect(n).toContainText('-34 dBm')
  await page.check('#f-direct')
  await expect(n).toContainText('hiding all', { timeout: 10000 })
})
test('ordinary traffic gets no notice at all', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: normal } }))
  await page.goto('/?mode=points')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.locator('#hop-notice')).toBeHidden()
})

test('Sender unknown narrows on the tick, not on the next rolling refresh', async ({ page }) => {
  // The coarse handle for a flood with no sender. The request has to carry it,
  // because the narrowing happens in SQL -- a client-side filter would page
  // through the wrong 25,000 rows.
  //
  // The range is absolute on purpose, and that is the whole test. A relative
  // range keeps updateTimeRangeTimer (map.js) refreshing every 10s, and that
  // refresh carries whatever currentFilters() returns -- including a param no
  // control ever asked to apply. Written against the default range, this passes
  // with #f-unnamed wired to nothing at all, which is how it shipped.
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: flood } }) })
  await page.goto('/?mode=points&from=2026-08-24T00:00:00Z&to=2026-08-25T00:00:00Z')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  // Wait for the initial load to settle before touching the control. Ticking
  // while the map is still fitting its view lets a moveend refresh carry the
  // param a few hundred ms later, which looks exactly like the control working.
  await expect.poll(() => { const n = urls.length; return new Promise((r) => setTimeout(() => r(n === urls.length), 1500)) }).toBe(true)
  const settled = urls.length
  await page.check('#f-unnamed')
  await expect.poll(() => urls.slice(settled).some((u) => new URL(u).searchParams.get('unnamed') === '1'), { timeout: 3000 }).toBe(true)
  await expect(page).toHaveURL(/unnamed=1/)
})

test('the control says what it filters on, not what someone hoped it meant', async ({ page }) => {
  // "Direct only" promised distance and delivered a sender-written claim. The
  // label and its title now describe the field.
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')
  const label = page.locator('label:has(#f-direct)')
  await expect(label).toContainText('No path')
  await expect(label).toHaveAttribute('title', /written by the sender/)
})
