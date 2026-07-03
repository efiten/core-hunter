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

  await page.route('**/api/auth/login', r => r.fulfill({ json: { role: 'member', username: 'alice' } }))
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
