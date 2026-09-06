import { test, expect, openSettings, openFilters, closeFilters } from './fixtures.js'

// #595: 3D on the map is the app's 3D. The canvas has no DOM to read, so the
// page's hooks answer what a layer is set to, where the camera is and what
// the terrain does; the button, the URL and the Settings control are DOM.
const vis = (page, id) => page.evaluate((l) => window.__layerVisible(l), id)
const pitch = (page) => page.evaluate(() => window.__mapPitch())
const bearing = (page) => page.evaluate(() => window.__mapBearing())
const mounted = (page) => page.waitForFunction(() => window.__layerVisible && window.__layerVisible('hex') !== undefined && !!window.__terrain)

test('the view button turns 3D on: pressed, tilted to 60, bars for the flat cells, ?view=3d in the URL, and back', async ({ page }) => {
  await page.goto('/')
  await mounted(page)
  await page.waitForFunction(() => window.__layerVisible('hex'))
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(await vis(page, 'hex-3d')).toBe(false)

  await page.click('#view-toggle')
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-label', 'View: 3D')
  await expect(page).toHaveURL(/[?&]view=3d/)
  // The cold mode is hex: in 3D the cells are bars, the flat fill and its outline go.
  expect(await vis(page, 'hex-3d')).toBe(true)
  expect(await vis(page, 'hex')).toBe(false)
  expect(await vis(page, 'hex-outline')).toBe(false)
  await page.waitForFunction(() => Math.round(window.__mapPitch()) === 60)
  await expect(page).toHaveURL(/[?&]pitch=60/)

  await page.click('#view-toggle')
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-pressed', 'false')
  await page.waitForFunction(() => Math.round(window.__mapPitch()) === 0)
  await expect(page).not.toHaveURL(/[?&]view=/)
  await expect(page).not.toHaveURL(/[?&]pitch=/)
  expect(await vis(page, 'hex')).toBe(true)
  expect(await vis(page, 'hex-3d')).toBe(false)
})

test('a shared link carries the view and the camera: ?view=3d&pitch=45&bearing=30 lands tilted and turned, and stays so in the URL', async ({ page }) => {
  await page.goto('/?view=3d&pitch=45&bearing=30')
  await mounted(page)
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-pressed', 'true')
  expect(Math.round(await pitch(page))).toBe(45)
  expect(Math.round(await bearing(page))).toBe(30)
  await page.waitForFunction(() => window.__layerVisible('hex-3d'))
  await expect(page).toHaveURL(/[?&]view=3d/)
  await expect(page).toHaveURL(/[?&]pitch=45/)
  await expect(page).toHaveURL(/[?&]bearing=30/)
})

test('?view=3d on its own takes the fixed tilt, as the button does', async ({ page }) => {
  await page.goto('/?view=3d')
  await mounted(page)
  expect(Math.round(await pitch(page))).toBe(60)
  expect(Math.abs(Math.round(await bearing(page)))).toBe(0) // -0 from MapLibre's wrap
  await expect(page).toHaveURL(/[?&]pitch=60/)
  await expect(page).not.toHaveURL(/[?&]bearing=/)
})

test('turning the map writes the bearing into the URL, and the compass puts north back', async ({ page }) => {
  await page.goto('/')
  await mounted(page)
  // MapLibre's keyboard handler turns the map 15 degrees on Shift+Arrow; a
  // deterministic gesture, unlike a right-drag measured in pixels.
  await page.locator('.maplibregl-canvas').focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await page.waitForFunction(() => Math.abs(Math.round(window.__mapBearing())) === 15)
  await expect(page).toHaveURL(/[?&]bearing=-?15/)
  await page.click('.maplibregl-ctrl-compass')
  await page.waitForFunction(() => Math.round(window.__mapBearing()) === 0)
  await expect(page).not.toHaveURL(/[?&]bearing=/)
})

test('in 3D the receptions stand as pillars, collapsed where they coincide, and Both keeps the cells flat under them', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'alice' } }))
  const M = 1 / 111320
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [
    { lat: 51, lon: 4, rssi: -60, rx_at: '2026-09-06T10:00:00Z', sender_id: 'aaaa' },
    { lat: 51 + 5 * M, lon: 4, rssi: -90, rx_at: '2026-09-06T10:00:01Z', sender_id: 'aaaa' },   // 5 m: one pillar with the first
    { lat: 51.002, lon: 4.002, rssi: -100, rx_at: '2026-09-06T10:00:02Z', sender_id: 'bbbb' },
  ] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.goto('/?mode=points&view=3d&lat=51&lon=4&z=16')
  await mounted(page)
  await page.waitForFunction(() => window.__featureCount('points') === 3)
  expect(await page.evaluate(() => window.__featureCount('points-3d'))).toBe(2)
  expect(await vis(page, 'points-3d')).toBe(true)
  expect(await vis(page, 'points')).toBe(false)
  expect(await vis(page, 'hex-3d')).toBe(false)

  await openFilters(page)
  await page.click('#lm-both')
  await closeFilters(page)
  // Both in 3D: pillars over FLAT cells (maplayers.js), since an extruded
  // cell is at least as tall as every pillar in it and would hide them.
  await expect.poll(() => vis(page, 'hex')).toBe(true)
  expect(await vis(page, 'hex-3d')).toBe(false)
  expect(await vis(page, 'points-3d')).toBe(true)

  // Back in 2D the pillars are not built at all.
  await page.click('#view-toggle')
  await expect.poll(() => page.evaluate(() => window.__featureCount('points-3d'))).toBe(0)
  expect(await vis(page, 'points')).toBe(true)
})

test('3D carries the terrain: hillshade on in 3D at the Settings exaggeration, off again in 2D', async ({ page }) => {
  await page.goto('/?view=3d')
  await mounted(page)
  await page.waitForFunction(() => window.__layerVisible('hillshade'))
  expect(await page.evaluate(() => window.__paint('hillshade', 'hillshade-exaggeration'))).toBeCloseTo(0.7, 5)
  expect(await page.evaluate(() => window.__terrain().on)).toBe(true)
  await expect(page).not.toHaveURL(/[?&]exag=/) // the default stays out of the URL

  await openSettings(page)
  await expect(page.locator('#ss-exag')).toHaveValue('7')
  await page.selectOption('#ss-exag', '4')
  await expect(page).toHaveURL(/[?&]exag=4/)
  await expect.poll(() => page.evaluate(() => window.__paint('hillshade', 'hillshade-exaggeration'))).toBeCloseTo(0.4, 5)
  await page.click('#ss-close')

  await page.click('#view-toggle')
  await page.waitForFunction(() => !window.__layerVisible('hillshade'))
  expect(await page.evaluate(() => window.__terrain().on)).toBe(false)
  await expect(page).toHaveURL(/[?&]exag=4/) // a Settings choice, kept

  // A reload restores it from storage, like the theme.
  await page.goto('/')
  await mounted(page)
  await openSettings(page)
  await expect(page.locator('#ss-exag')).toHaveValue('4')
})
