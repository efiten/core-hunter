import { test, expect } from '@playwright/test'

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
