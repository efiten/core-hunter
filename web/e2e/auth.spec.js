import { test, expect } from './fixtures.js'

async function mockRole(page, me) {
  await page.route('**/api/auth/me', r => r.fulfill({ json: me }))
  await page.route('**/api/points*', r => r.fulfill({ json: { points: [], truncated: false } }))
  await page.route('**/api/heatmap*', r => r.fulfill({ json: { type: 'FeatureCollection', features: [] } }))
  await page.route('**/api/hunters*', r => r.fulfill({ json: { hunters: [] } }))
}

test('guest sees a Log in button and can log in', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.goto('/')
  await expect(page.locator('#auth-btn')).toHaveText(/log in/i)

  // The login response is deliberately a different (minimal) shape from /api/auth/me —
  // if the client trusted this body instead of re-fetching /api/auth/me, the button
  // would stay "Log in" (no username here) instead of showing "alice".
  await page.route('**/api/auth/login', r => r.fulfill({ json: { ok: true } }))
  await page.click('#auth-btn')
  await page.fill('#login-user', 'alice')
  await page.fill('#login-pass', 'correcthorse')
  // after login the client re-fetches /api/auth/me — return the logged-in identity
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'member', username: 'alice' } }))
  await page.click('#login-submit')
  await expect(page.locator('#auth-btn')).toHaveText(/alice/i)
})

test('bad credentials show an error', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.goto('/')
  await page.route('**/api/auth/login', r => r.fulfill({ status: 401, json: { error: 'bad_credentials' } }))
  await page.click('#auth-btn')
  await page.fill('#login-user', 'x')
  await page.fill('#login-pass', 'wrongwrongwrong')
  await page.click('#login-submit')
  await expect(page.locator('#login-error')).toBeVisible()
})

test('logout returns the button to Log in', async ({ page }) => {
  await mockRole(page, { role: 'member', username: 'alice' })
  await page.goto('/')
  await expect(page.locator('#auth-btn')).toHaveText(/alice/i)

  await page.route('**/api/auth/logout', r => r.fulfill({ status: 204 }))
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'guest' } }))
  await page.click('#auth-btn')
  await expect(page.locator('#auth-btn')).toHaveText(/log in/i)
})

test('guest sees the degraded-view notice; member does not', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.goto('/')
  await expect(page.locator('#guest-notice')).toBeVisible()

  await mockRole(page, { role: 'member', username: 'm' })
  await page.reload()
  await expect(page.locator('#guest-notice')).toBeHidden()
})

test('Locate is hidden for guests, shown for members', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.goto('/')
  await expect(page.locator('#locate-toggle')).toBeHidden()

  await mockRole(page, { role: 'member', username: 'm' })
  await page.reload()
  await expect(page.locator('#locate-toggle')).toBeVisible()
})

// A small spread of synthetic receptions (same shape as locate.spec.js) so the
// solver has enough points to produce a centroid/strongest marker.
const LOCATE_POINTS = [
  { lat: 51.000, lon: 4.000, rssi: -52 }, // strongest
  { lat: 51.010, lon: 4.000, rssi: -88 },
  { lat: 50.990, lon: 4.000, rssi: -90 },
  { lat: 51.000, lon: 4.012, rssi: -86 },
]

test('member ?locate=1 restores Locate', async ({ page }) => {
  await mockRole(page, { role: 'member', username: 'm' })
  await page.route('**/api/points*', r => r.fulfill({ json: { points: LOCATE_POINTS, truncated: false } }))
  await page.goto('/?locate=1&sender=aa')
  // currentRole is only known once /api/auth/me resolves (async); the restore
  // is deferred until then, so give it a moment before asserting.
  await expect(page.locator('.lc-strongest')).toHaveCount(1)
  await expect(page.locator('#locate-info')).toBeVisible()
})

test('guest ?locate=1 does not restore Locate', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.goto('/?locate=1&sender=aa')
  await expect(page.locator('#locate-toggle')).toBeHidden()
  await expect(page.locator('.lc-strongest')).toHaveCount(0)
})

test('observer-point layers are hidden for guests and a 403 does not break the map', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.route('**/api/observer-points*', r => r.fulfill({ status: 403, json: { error: 'forbidden' } }))
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e))
  await page.goto('/')
  // the CS-layer toggle must not be shown for guests
  await expect(page.locator('.cs-layer-toggle')).toBeHidden()
  // map still renders (no unhandled rejection breaking the app)
  await expect(page.locator('#map')).toBeVisible()
  expect(pageErrors).toHaveLength(0)
})

test('observer-point (CS) layers are available for members', async ({ page }) => {
  await mockRole(page, { role: 'member', username: 'm' })
  await page.route('**/api/observer-points*', r => r.fulfill({ json: { points: [] } }))
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e))
  await page.goto('/')
  await expect(page.locator('.cs-layer-toggle')).toBeVisible()
  const req = page.waitForRequest((r) => r.url().includes('/observer-points'))
  await page.check('#cs-adverts')
  await req
  await expect(page.locator('#map')).toBeVisible()
  expect(pageErrors).toHaveLength(0)
})

// Regression: the CS-layer deep-link restore (?adv=1/?rel=1) runs at module-eval
// time, before /api/auth/me resolves — currentRole is still 'guest' then, so
// drawObserverPoints() early-returns and the checkbox ends up checked with an
// empty layer. Once the real (member) role lands, applyObserverGate() must
// redraw any checked CS layers, not just unhide the toggle.
test('member deep-link ?adv=1 draws the CS advert layer on load', async ({ page }) => {
  await mockRole(page, { role: 'member', username: 'm' })
  await page.route('**/api/observer-points*', r => r.fulfill({ json: { points: [
    { lat: 51.0, lon: 4.0, rssi: -60, snr: 8, heard_key: 'aa', observer: 'obs1', rx_at: '2026-07-03T10:00:00Z' }
  ] } }))
  await page.goto('/?adv=1')
  await expect(page.locator('#cs-adverts')).toBeChecked()
  // mode defaults to 'hex' with an empty heatmap and no points, so any rendered
  // path marker on the map can only be the CS advert layer's circleMarker.
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(1)
})

test('guest popup has no Locate button', async ({ page }) => {
  await mockRole(page, { role: 'guest' })
  await page.route('**/api/points*', r => r.fulfill({ json: { points: [
    { lat: 51, lon: 4, rssi: -60, snr: 8, sender_id: 'aa', hunter_name: 'Hunter 1', rx_at: '2026-07-03T10:00:00Z' }
  ], truncated: false } }))
  await page.goto('/?mode=points') // point markers — the cold default is hex (#141)
  // Points render on a canvas (no per-marker DOM); the fixture point [51,4] is
  // the initial map center, so clicking the middle of the map hits it.
  await expect(async () => {
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(page.locator('.lc-locate')).toHaveCount(0)
})
