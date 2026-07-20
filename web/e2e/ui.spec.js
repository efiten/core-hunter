import { test, expect, mapSettled } from './fixtures.js'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
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
  await page.click('#layer-toggle') // hex -> both
  await expect(page.locator('#layer-toggle')).toHaveText('both')

  // Reload with a bare URL: the URL was rewritten by replaceState, so strip it to
  // prove the state is also restored from localStorage alone.
  await page.evaluate(() => history.replaceState(null, '', location.pathname))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#layer-toggle')).toHaveText('both')
})

test('map starts in hex mode (#141), fetches /api/heatmap, and the toggle cycles hex → both → points', async ({ page }) => {
  const heatmapReq = page.waitForRequest('**/api/heatmap*')
  await page.goto('/')
  const btn = page.locator('#layer-toggle')
  await expect(btn).toHaveText('hex')
  await heatmapReq // the cold default drew the heatmap layer

  await btn.click()
  await expect(btn).toHaveText('both')
  await btn.click()
  await expect(btn).toHaveText('points')
  await btn.click()
  await expect(btn).toHaveText('hex')
})

test('hunter dropdown is populated from /api/hunters', async ({ page }) => {
  await page.goto('/')
  // No "All hunters" placeholder (#196): empty selection already means all.
  await expect(page.locator('#f-hunter option')).toHaveCount(1)
  await expect(page.locator('#f-hunter')).toContainText('ON8AR (42)')
})

test('hunter filter supports multi-select and reaches /api/heatmap as a comma-separated list (#196)', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [
      { hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 42 },
      { hunter_pubkey: 'def456abc123', hunter_name: 'ON7BE', count: 7 },
    ] },
  }))
  await page.goto('/') // cold default mode is hex (#141) -> /api/heatmap, not /api/points
  await expect(page.locator('#f-hunter')).toHaveJSProperty('multiple', true)

  const req = page.waitForRequest((r) => r.url().includes('/api/heatmap') && r.url().includes('hunter=abc123def456%2Cdef456abc123'))
  await page.locator('#f-hunter').selectOption(['abc123def456', 'def456abc123'])
  await req
  await expect(page).toHaveURL(/hunter=abc123def456%2Cdef456abc123/)

  // Deselecting back to nothing means "all hunters" again -- the param drops.
  const reqAll = page.waitForRequest((r) => r.url().includes('/api/heatmap') && !r.url().includes('hunter='))
  await page.locator('#f-hunter').selectOption([])
  await reqAll
  await expect(page).not.toHaveURL(/hunter=/)
})

test('a shared URL with multiple hunters restores the selection (#196)', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [
      { hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 42 },
      { hunter_pubkey: 'def456abc123', hunter_name: 'ON7BE', count: 7 },
    ] },
  }))
  await page.goto('/?hunter=abc123def456,def456abc123')
  await expect(page.locator('#f-hunter')).toHaveValues(['abc123def456', 'def456abc123'])
})

test('with no saved/URL view and no data, the map opens on a neutral world view, not the old Belgium-ish default (#218)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/')
  // Leaflet snaps setView() to its internal pixel grid, so the center isn't
  // exact at low zoom -- precision 1 (±0.05°) comfortably covers that drift.
  const center = await page.evaluate(() => window.__mapCenter())
  expect(center.lat).toBeCloseTo(20, 1)
  expect(center.lng).toBeCloseTo(0, 1)
  expect(await page.evaluate(() => window.__mapZoom())).toBe(2)
})

test('with no saved/URL view, the map snaps to today\'s actual points once fetched (#218)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [
    { lat: 60.2, lon: 24.9, rssi: -70, snr: -3, hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', rx_at: '2026-07-11T12:00:00Z' },
  ] } }))
  await page.goto('/')
  await expect(async () => {
    const center = await page.evaluate(() => window.__mapCenter())
    expect(center.lat).toBeCloseTo(60.2, 1)
    expect(center.lng).toBeCloseTo(24.9, 1)
  }).toPass()
})

test('snap to hunter: selecting a single hunter fits bounds and drops a marker at the latest position (#195)', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [{ hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 2 }] },
  }))
  await page.route('**/api/points*', (r) => {
    const u = new URL(r.request().url())
    if (u.searchParams.get('hunter') === 'abc123def456') {
      return r.fulfill({ json: { points: [
        // newest first (server order) -> this one is the "latest position"
        { lat: 55.5, lon: 8.5, rssi: -70, snr: -3, hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', rx_at: '2026-07-08T12:00:00Z' },
        { lat: 55.4, lon: 8.4, rssi: -80, snr: -5, hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', rx_at: '2026-07-08T11:00:00Z' },
      ] } })
    }
    return r.fulfill({ json: { points: [] } })
  })
  await page.goto('/')

  await page.locator('#f-hunter').selectOption(['abc123def456'])
  await expect(async () => {
    const marker = await page.evaluate(() => window.__hunterMarkerLatLng())
    expect(marker).toBeTruthy()
    expect(marker.lat).toBeCloseTo(55.5, 3)
    expect(marker.lng).toBeCloseTo(8.5, 3)
  }).toPass()
  // Map actually moved to the far-away fixture cluster (was centered near 51,4).
  expect(await page.evaluate(() => window.__mapCenter().lat)).toBeGreaterThan(54)

  // Deselecting back to "All hunters" removes the marker without moving the map.
  const centerBefore = await page.evaluate(() => window.__mapCenter())
  await page.locator('#f-hunter').selectOption([])
  await expect(async () => {
    expect(await page.evaluate(() => window.__hunterMarkerLatLng())).toBeNull()
  }).toPass()
  const centerAfter = await page.evaluate(() => window.__mapCenter())
  expect(centerAfter.lat).toBeCloseTo(centerBefore.lat, 5)
  expect(centerAfter.lng).toBeCloseTo(centerBefore.lng, 5)
})

test('snap to hunter: selecting multiple hunters fits to the union without a marker (#195, pairs with #196)', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [
      { hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 1 },
      { hunter_pubkey: 'def456abc123', hunter_name: 'ON7BE', count: 1 },
    ] },
  }))
  await page.route('**/api/points*', (r) => {
    const u = new URL(r.request().url())
    if (u.searchParams.get('hunter') === 'abc123def456,def456abc123') {
      return r.fulfill({ json: { points: [
        { lat: 55.5, lon: 8.5, rssi: -70, snr: -3, hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', rx_at: '2026-07-08T12:00:00Z' },
        { lat: 55.6, lon: 8.6, rssi: -75, snr: -4, hunter_pubkey: 'def456abc123', hunter_name: 'ON7BE', rx_at: '2026-07-08T11:30:00Z' },
      ] } })
    }
    return r.fulfill({ json: { points: [] } })
  })
  await page.goto('/')

  await page.locator('#f-hunter').selectOption(['abc123def456', 'def456abc123'])
  await expect(async () => {
    expect(await page.evaluate(() => window.__mapCenter().lat)).toBeGreaterThan(54)
  }).toPass()
  expect(await page.evaluate(() => window.__hunterMarkerLatLng())).toBeNull()
})

test('hunter dropdown shows pseudonymised labels for guests', async ({ page }) => {
  // Guests get server-issued pseudonyms (hunter_pubkey="h<N>", hunter_name="Hunter <N>");
  // override this spec's default member mock just for this test.
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [{ hunter_pubkey: 'h1', hunter_name: 'Hunter 1', count: 42 }] },
  }))
  await page.goto('/')

  const opt = page.locator('#f-hunter option', { hasText: 'Hunter 1 (42)' })
  await expect(opt).toHaveCount(1)
  await expect(opt).toHaveAttribute('value', 'h1')
})

test('discover sender: prefix ID is resolved to a name via the API, popup shows name · role', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({
    json: { points: [{
      lat: 51, lon: 4, rssi: -90, snr: -8,
      sender_id: '7b0e24700e0c0d3e', sender_label: '', sender_role: 'Repeater',
      hunter_name: 'X', packet_type: 'Control', rx_at: '2026-06-30T15:40:51Z',
    }] },
  }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: 'NEO7HI', ambiguous: false } }))

  // the website must look up the 8-byte discover prefix (not just full pubkeys)
  const resolveReq = page.waitForRequest((r) => r.url().includes('/api/resolve') && r.url().includes('7b0e24700e0c0d3e'))
  await page.goto('/?mode=points') // point markers — the cold default is hex (#141)
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
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: '', ambiguous: false } }))
  await page.goto('/?mode=points') // point markers — the cold default is hex (#141)

  // Canvas-rendered point: click the map center where the fixture marker sits.
  // Only once the view has settled — a click during fitBounds' animation misses.
  await mapSettled(page)
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
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: 'BE-HSS-DinX', ambiguous: false } }))
  await page.goto('/')

  await expect(page.locator('#cs-relays')).not.toBeChecked() // off by default
  await page.check('#cs-relays')

  await mapSettled(page)
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
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: 'BE-HSS-DinX', ambiguous: false } }))
  await page.goto('/')
  await page.check('#cs-relays')

  const locateReq = page.waitForRequest((r) => r.url().includes('/observer-points') && r.url().includes('heard_key=1d6f'))
  await mapSettled(page)
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

test('unchecking a CS layer clears it even if a name-resolution redraw is in flight', async ({ page }) => {
  await page.route('**/api/observer-points*', (route) => {
    const src = new URL(route.request().url()).searchParams.get('src')
    const pts = src === 'rxlog'
      ? [{ lat: 51, lon: 4, rssi: -100, snr: -5, heard_key: '1d6f', src: 'rxlog', observer: 'Erwin Mobile', rx_at: '2026-06-30T15:00:00Z' }]
      : []
    route.fulfill({ json: { points: pts } })
  })
  // Slow resolver: the point draws immediately (unresolved), then a redraw is
  // scheduled for when this resolves. We uncheck before it does.
  await page.route('**/api/resolve*', async (r) => {
    await new Promise((res) => setTimeout(res, 400))
    r.fulfill({ json: { name: 'BE-HSS-DinX', ambiguous: false } })
  })
  await page.goto('/')

  await page.check('#cs-relays')
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(1) // point drawn
  await page.uncheck('#cs-relays')
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(0) // cleared now
  await expect(page).toHaveURL((u) => !u.searchParams.has('rel'))
  // Wait past the resolver delay: the pending redraw must NOT re-add the point.
  await page.waitForTimeout(700)
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(0)
})

test('Clear button resets filters, drops CS layers, and leaves the URL clean', async ({ page }) => {
  await page.route('**/api/observer-points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?sender=4a2b&adv=1')
  await expect(page.locator('#f-sender')).toHaveValue('4a2b')
  await expect(page.locator('#cs-adverts')).toBeChecked()

  await page.click('#clear-filters')
  await expect(page.locator('#f-sender')).toHaveValue('')
  await expect(page.locator('#cs-adverts')).not.toBeChecked()
  await expect(page).toHaveURL((u) => !u.searchParams.has('sender') && !u.searchParams.has('adv'))
})

test('hovering the sender box shows the resolved node name via the input tooltip', async ({ page }) => {
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: 'NEO7HI', ambiguous: false } }))
  await page.goto('/')
  await page.fill('#f-sender', '7b0e24700e0c0d3e')
  await expect(page.locator('#f-sender')).toHaveAttribute('title', 'NEO7HI')
})

test('sender filter reaches the /api/points query', async ({ page }) => {
  await page.goto('/?mode=points') // points requests — the cold default is hex (#141)
  const req = page.waitForRequest((r) => r.url().includes('/api/points') && r.url().includes('sender=4a'))
  await page.fill('#f-sender', '4a')
  await req // only resolves if a points request carrying sender=4a was issued
})

test('assets are cache-busted with the version query', async ({ page }) => {
  await page.goto('/')
  const cssHref = await page.getAttribute('link[rel="stylesheet"][href^="style.css"]', 'href')
  expect(cssHref).toMatch(/^style\.css\?v=/)
})

test('the site is installable: manifest is linked and valid, no service worker (#194)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /^\/manifest\.webmanifest\?v=/)
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0e14')

  const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()))
  expect(manifest.display).toBe('standalone')
  expect(manifest.name).toBeTruthy()
  expect(manifest.icons.length).toBeGreaterThan(0)

  // No offline caching (explicitly out of scope, #194) -- the site always needs the API.
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations())
  expect(regs).toHaveLength(0)
})
