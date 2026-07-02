import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [{ hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 42 }] },
  }))
})

test('theme toggle flips data-theme, persists, reflects in URL, and swaps the glyph', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('#theme-toggle')).toHaveText('🌙')

  await page.click('#theme-toggle')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#theme-toggle')).toHaveText('☀️')
  await expect(page).toHaveURL(/theme=light/)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ch-state')).theme)).toBe('light')
})

test('a shared URL reproduces the exact view (theme, layer mode, sender, zoom)', async ({ page }) => {
  // Open a link carrying full state — a second viewer must see the same thing.
  await page.goto('/?theme=light&mode=hex&sender=4a2b&z=15')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#theme-toggle')).toHaveText('☀️')
  await expect(page.locator('#layer-toggle')).toHaveText('hex')
  await expect(page.locator('#f-sender')).toHaveValue('4a2b')
  expect(await page.evaluate(() => window.__mapZoom && window.__mapZoom())).toBe(15)
})

test('settings survive a reload via localStorage (no URL params)', async ({ page }) => {
  await page.goto('/')
  await page.click('#theme-toggle') // -> light
  await page.click('#layer-toggle') // points -> hex
  await expect(page.locator('#layer-toggle')).toHaveText('hex')

  // Reload with a bare URL: the URL was rewritten by replaceState, so strip it to
  // prove the state is also restored from localStorage alone.
  await page.evaluate(() => history.replaceState(null, '', location.pathname))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#layer-toggle')).toHaveText('hex')
})

test('layer toggle cycles points → hex → both, and hex fetches /api/heatmap', async ({ page }) => {
  await page.goto('/')
  const btn = page.locator('#layer-toggle')
  await expect(btn).toHaveText('points')

  const heatmapReq = page.waitForRequest('**/api/heatmap*')
  await btn.click()
  await expect(btn).toHaveText('hex')
  await heatmapReq // hex mode drew the heatmap layer

  await btn.click()
  await expect(btn).toHaveText('both')
  await btn.click()
  await expect(btn).toHaveText('points')
})

test('hunter dropdown is populated from /api/hunters', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#f-hunter option')).toHaveCount(2) // "All hunters" + the fetched one
  await expect(page.locator('#f-hunter')).toContainText('ON8AR (42)')
})

test('discover sender: prefix ID is resolved to a name via the API, popup shows name · role', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({
    json: { points: [{
      lat: 51, lon: 4, rssi: -90, snr: -8,
      sender_id: '7b0e24700e0c0d3e', sender_label: '', sender_role: 'Repeater',
      hunter_name: 'X', packet_type: 'Control', rx_at: '2026-06-30T15:40:51Z',
    }] },
  }))
  await page.route('**/nodes/resolve*', (r) => r.fulfill({ json: { name: 'NEO7HI', ambiguous: false } }))

  // the website must look up the 8-byte discover prefix (not just full pubkeys)
  const resolveReq = page.waitForRequest((r) => r.url().includes('/nodes/resolve') && r.url().includes('7b0e24700e0c0d3e'))
  await page.goto('/')
  await resolveReq

  // after resolution + redraw, the marker popup shows the resolved name and role.
  // Points render on a canvas (no per-marker DOM); the fixture point [51,4] is
  // the initial map center, so clicking the middle of the map hits it.
  await expect(async () => {
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.leaflet-popup-content')).toContainText('NEO7HI · Repeater', { timeout: 1000 })
  }).toPass()
})

test('point popup "Locate this sender" fills the filter and starts a locate', async ({ page }) => {
  const SID = 'db11db11f7808b97'
  await page.route('**/api/points*', (r) => r.fulfill({
    json: { points: [{
      lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: SID, sender_label: '',
      sender_role: 'Repeater', hunter_name: 'X', packet_type: 'Control', rx_at: '2026-06-30T15:40:51Z',
    }] },
  }))
  await page.route('**/nodes/resolve*', (r) => r.fulfill({ json: { name: '', ambiguous: false } }))
  await page.goto('/')

  // Canvas-rendered point: click the map center where the fixture marker sits.
  await expect(async () => {
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.lc-locate')).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.locator('.lc-locate').click()

  await expect(page.locator('#f-sender')).toHaveValue(SID)
  await expect(page.locator('#locate-toggle')).toHaveClass(/on/)
  await expect(page.locator('#locate-info')).toBeVisible()
})

test('CoreScope relays checkbox (off by default) draws observer points with resolved name', async ({ page }) => {
  await page.route('**/api/observer-points*', (route) => {
    const src = new URL(route.request().url()).searchParams.get('src')
    const pts = src === 'rxlog'
      ? [{ lat: 51, lon: 4, rssi: -100, snr: -5, heard_key: '1d6f', src: 'rxlog', observer: 'Erwin Mobile', rx_at: '2026-06-30T15:00:00Z' }]
      : []
    route.fulfill({ json: { points: pts } })
  })
  await page.route('**/nodes/resolve*', (r) => r.fulfill({ json: { name: 'BE-HSS-DinX', ambiguous: false } }))
  await page.goto('/')

  await expect(page.locator('#cs-relays')).not.toBeChecked() // off by default
  await page.check('#cs-relays')

  await expect(async () => {
    await page.locator('path.leaflet-interactive').first().click({ force: true })
    await expect(page.locator('.leaflet-popup-content')).toContainText('relay BE-HSS-DinX', { timeout: 1000 })
  }).toPass()
  await expect(page.locator('.leaflet-popup-content')).toContainText('Erwin Mobile')
})

test('Locate from a CoreScope relay popup uses observer-points (heard_key) for that node', async ({ page }) => {
  const HK = '1d6f'
  await page.route('**/api/observer-points*', (route) => {
    const u = new URL(route.request().url())
    const heardKey = u.searchParams.get('heard_key')
    const src = u.searchParams.get('src')
    let pts = []
    if (!heardKey && src === 'rxlog') {
      pts = [{ lat: 51, lon: 4, rssi: -100, snr: -5, heard_key: HK, src: 'rxlog', observer: 'Erwin Mobile', rx_at: '2026-06-30T15:00:00Z' }]
    } else if (heardKey === HK) {
      pts = [
        { lat: 51.000, lon: 4.000, rssi: -60, snr: -3 },
        { lat: 51.010, lon: 4.000, rssi: -90, snr: -8 },
        { lat: 50.990, lon: 4.000, rssi: -88, snr: -7 },
      ]
    }
    route.fulfill({ json: { points: pts } })
  })
  await page.route('**/nodes/resolve*', (r) => r.fulfill({ json: { name: 'BE-HSS-DinX', ambiguous: false } }))
  await page.goto('/')
  await page.check('#cs-relays')

  const locateReq = page.waitForRequest((r) => r.url().includes('/observer-points') && r.url().includes('heard_key=1d6f'))
  await expect(async () => {
    await page.locator('path.leaflet-interactive').first().click({ force: true })
    await expect(page.locator('.lc-locate')).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.locator('.lc-locate').click()

  await expect(page.locator('#f-sender')).toHaveValue(HK)
  await expect(page.locator('#locate-toggle')).toHaveClass(/on/)
  await locateReq // Locate pulled this relay's CoreScope sightings by heard_key
  await expect(page.locator('#locate-info')).toBeVisible()
})

test('sender filter reaches the /api/points query', async ({ page }) => {
  await page.goto('/')
  const req = page.waitForRequest((r) => r.url().includes('/api/points') && r.url().includes('sender=4a'))
  await page.fill('#f-sender', '4a')
  await req // only resolves if a points request carrying sender=4a was issued
})
