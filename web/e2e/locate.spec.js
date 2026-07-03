import { test, expect } from '@playwright/test'

// A small spread of synthetic receptions around (51, 4): one strong, several weak,
// all > 10 m apart (so dedupe keeps them) and < 20 km (so none are rejected).
const POINTS = [
  { lat: 51.000, lon: 4.000, rssi: -52 }, // strongest
  { lat: 51.010, lon: 4.000, rssi: -88 },
  { lat: 50.990, lon: 4.000, rssi: -90 },
  { lat: 51.000, lon: 4.012, rssi: -86 },
]

// Stub the read endpoints by default so the page's own refresh/poll never errors
// and the test asserts only what it sets up. Individual tests override as needed.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('__locateRender draws centroid, strongest marker, heatmap and info card', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__locateRender === 'function')
  await page.evaluate((pts) => window.__locateRender(pts, '4a'), POINTS)

  await expect(page.locator('.lc-centroid')).toHaveCount(1)
  await expect(page.locator('.lc-strongest')).toHaveCount(1)
  await expect(page.locator('img.leaflet-image-layer')).toHaveCount(1) // heatmap overlay
  const info = page.locator('#locate-info')
  await expect(info).toBeVisible()
  await expect(info).toContainText('search radius')
  await expect(info).toContainText('strongest -52 dBm')
  await expect(info).toContainText('1-byte ID') // senderId '4a' (< 64 chars) -> hash note
})

test('"?" toggles the plain-English legend in the Locate info box', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__locateRender === 'function')
  await page.evaluate((pts) => window.__locateRender(pts, '4a'), POINTS)

  const legend = page.locator('#locate-info .lc-legend')
  const help = page.locator('#locate-info .lc-help')
  await expect(legend).toBeHidden() // collapsed by default
  await expect(help).toHaveAttribute('aria-expanded', 'false')

  await help.click()
  await expect(legend).toBeVisible()
  await expect(legend).toContainText('Search radius')
  await expect(help).toHaveAttribute('aria-expanded', 'true')

  // survives a re-render (5 s poll re-renders the box)
  await page.evaluate((pts) => window.__locateRender(pts, '4a'), POINTS)
  await expect(page.locator('#locate-info .lc-legend')).toBeVisible()

  await page.locator('#locate-info .lc-help').click()
  await expect(page.locator('#locate-info .lc-legend')).toBeHidden()
})

test('heatmap fades to a transparent border — no rectangle artifact', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__locateRender === 'function')
  await page.evaluate((pts) => window.__locateRender(pts, '4a'), POINTS)
  await expect(page.locator('img.leaflet-image-layer')).toHaveCount(1)

  // The whole outer ring of the heatmap image must be fully transparent (the 3σ
  // padding guarantees it), so there's no visible rectangular edge; the centre
  // (the hotspot) must still be drawn.
  const res = await page.evaluate(async () => {
    const img = document.querySelector('img.leaflet-image-layer')
    const im = new Image()
    await new Promise((r) => { im.onload = r; im.src = img.src })
    const cv = document.createElement('canvas')
    cv.width = im.naturalWidth; cv.height = im.naturalHeight
    const ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0)
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    const a = (x, y) => d[(y * cv.width + x) * 4 + 3]
    let borderMax = 0, globalMax = 0
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const al = a(x, y)
        if (al > globalMax) globalMax = al
        if (x === 0 || y === 0 || x === cv.width - 1 || y === cv.height - 1) borderMax = Math.max(borderMax, al)
      }
    }
    return { borderMax, globalMax }
  })
  expect(res.borderMax).toBe(0) // entire border transparent → no rectangle edge
  expect(res.globalMax).toBeGreaterThan(0) // the hotspot is still drawn somewhere
})

test('Locate button fetches /api/points and renders the overlay', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: POINTS } }))
  await page.goto('/')
  await page.fill('#f-sender', '4a')
  await page.click('#locate-toggle')

  await expect(page.locator('.lc-centroid')).toHaveCount(1)
  await expect(page.locator('.lc-strongest')).toHaveCount(1)
  await expect(page.locator('#locate-info')).toContainText('strongest -52 dBm')
})

test('Locate with no sender shows the prompt and does not fetch', async ({ page }) => {
  await page.goto('/')
  await page.click('#locate-toggle')
  await expect(page.locator('#locate-info')).toContainText('Enter a sender ID')
})

test('Locate surfaces a fetch error instead of crashing the poll loop', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ status: 500, body: 'boom' }))
  await page.goto('/')
  await page.fill('#f-sender', '4a')
  await page.click('#locate-toggle')
  await expect(page.locator('#locate-info')).toContainText('Could not load points')
})

test('best-signal star never renders for guests', async ({ page }) => {
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/points*', r => r.fulfill({ json: { points: [
    { lat: 51, lon: 4, rssi: -60, snr: 8, sender_id: 'aa', hunter_pubkey: 'h1', hunter_name: 'Hunter 1', rx_at: '2026-07-03T10:00:00Z' }
  ], truncated: false } }))
  await page.goto('/?locate=1&sender=aa')  // attempt to force Locate via URL
  await expect(page.locator('.lc-strongest')).toHaveCount(0)
  await expect(page.locator('.lc-centroid')).toHaveCount(0)
})
