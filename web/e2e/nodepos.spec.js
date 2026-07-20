import { test, expect } from './fixtures.js'

// Node-position layer (#197): a sender's self-advertised position (▲) drawn
// against our RSSI estimate (●), with the gap between them as drift.
const SENDER = 'aa'.repeat(32)

// A ring of receptions around (51.000, 4.000) — enough spread to clear the
// 3-inlier floor and produce a well-encircled estimate at the centre.
const ring = (lat, lon, rM, n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * 2 * Math.PI
  return {
    lat: lat + (rM * Math.sin(a)) / 111320,
    lon: lon + (rM * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)),
    rssi: -65 - i, snr: -3, sender_id: SENDER, sender_label: '', hunter_name: 'ON8AR',
    packet_type: 'Advert', rx_at: '2026-07-19T10:00:00Z',
  }
})

// advertised sits `driftLat` north of the estimate centre; resolve serves it.
function routes(page, { lat, lon, points }) {
  return Promise.all([
    page.route('**/api/points*', (r) => r.fulfill({ json: { points } })),
    page.route('**/api/resolve*', (r) => r.fulfill({
      json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false, lat, lon },
    })),
  ])
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('layer is off by default and the toggle is visible to a member', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await expect(page.locator('.np-layer-toggle')).toBeVisible()
  await expect(page.locator('#f-nodepos')).not.toBeChecked()
  await expect(page.locator('#nodepos-note')).toBeHidden()
})

test('checking it draws the advertised marker, reflects in the URL, and shows the disclaimer', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await page.check('#f-nodepos')

  // Exactly one marker per node — concurrent redraws must not leave duplicates.
  // The marker only appears after two sequential round-trips (points, then the
  // resolve that supplies the advertised position), so allow for both.
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  // The name is on the map, not only in the popup: the layer is opt-in.
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid')
  // §7: the disclaimer is on screen for as long as the layer is drawn.
  await expect(page.locator('#nodepos-note')).toBeVisible()
  await expect(page.locator('#nodepos-note')).toContainText('not GPS tracking')
  await expect(page).toHaveURL(/nodepos=1/)

  await page.locator('.np-advert').click({ force: true })
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toContainText('Repeater-Zuid')
  await expect(popup).toContainText('▲ advertised · ● estimated')
  await expect(popup).toContainText('self-reported')
})

test('a drift under 100 m reports a distance but claims no radius', async ({ page }) => {
  // ~46 m north of the estimate centre — inside the tight threshold, so the
  // popup states the drift but draws (and mentions) no circle.
  await routes(page, { lat: 51.0004, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await page.check('#f-nodepos')
  await page.locator('.np-advert').first().click({ force: true })
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toContainText(/drift \d+ m/)
  await expect(popup).not.toContainText('search radius')
  await expect(popup).not.toContainText('radius not trusted')
})

test('a one-sided estimate does not claim a search radius', async ({ page }) => {
  // Three points on one bearing only: encirclement stays below the 0.5 gate.
  const oneSided = [0, 1, 2].map((i) => ({
    lat: 51 + i * 0.0009, lon: 4, rssi: -70 - i, snr: -3, sender_id: SENDER, sender_label: '',
    hunter_name: 'ON8AR', packet_type: 'Advert', rx_at: '2026-07-19T10:00:00Z',
  }))
  await routes(page, { lat: 51.0025, lon: 4.0, points: oneSided })
  // Pin the view: with all points on one bearing the auto-fit (#218) is very
  // tight, which can push the advertised marker outside the viewport.
  await page.goto('/?lat=51.0012&lon=4.0&z=14')
  await page.check('#f-nodepos')
  await expect(page.locator('.np-advert')).toHaveCount(1)
  await page.locator('.np-advert').click({ force: true })
  await expect(page.locator('.leaflet-popup-content')).toContainText('radius not trusted')
})

test('the layer is hidden from a guest, whose resolve responses carry no position', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  // Mirrors the server stripping lat/lon below member (httpapi/resolve.go).
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: ring(51, 4, 250, 8) } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({
    json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false },
  }))
  await page.goto('/')
  await expect(page.locator('.np-layer-toggle')).toBeHidden()
  await expect(page.locator('.np-advert')).toHaveCount(0)
})
