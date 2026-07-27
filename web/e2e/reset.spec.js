import { test, expect } from './fixtures.js'

test('successful reset shows the confirmation message', async ({ page }) => {
  await page.route('**/api/auth/reset', r => r.fulfill({ status: 204 }))
  await page.goto('/reset.html?token=abc123')
  await page.fill('#rp-pass', 'longenoughpassword')
  await page.click('#reset-form button[type=submit]')
  await expect(page.locator('#rp-ok')).toBeVisible()
  await expect(page.locator('#rp-error')).toBeHidden()
})

test('invalid token shows an error', async ({ page }) => {
  await page.route('**/api/auth/reset', r => r.fulfill({ status: 400, json: { error: 'invalid_token' } }))
  await page.goto('/reset.html?token=bogus')
  await page.fill('#rp-pass', 'longenoughpassword')
  await page.click('#reset-form button[type=submit]')
  await expect(page.locator('#rp-error')).toBeVisible()
  await expect(page.locator('#rp-error')).toContainText(/invalid or expired/i)
  await expect(page.locator('#rp-ok')).toBeHidden()
})

test('too-short password is rejected client-side without hitting the server', async ({ page }) => {
  let called = false
  await page.route('**/api/auth/reset', r => { called = true; return r.fulfill({ status: 400, json: { error: 'password_too_short' } }) })
  await page.goto('/reset.html?token=abc123')
  await page.fill('#rp-pass', 'short')
  await page.click('#reset-form button[type=submit]')
  await expect(page.locator('#rp-error')).toBeVisible()
  await expect(page.locator('#rp-error')).toContainText(/at least 10 characters/i)
  expect(called).toBe(false)
})

test('server-reported too-short password shows the same message', async ({ page }) => {
  await page.route('**/api/auth/reset', r => r.fulfill({ status: 400, json: { error: 'password_too_short' } }))
  await page.goto('/reset.html?token=abc123')
  // 10+ chars client-side so the request reaches the (mocked) server
  await page.fill('#rp-pass', 'longenoughpassword')
  await page.click('#reset-form button[type=submit]')
  await expect(page.locator('#rp-error')).toBeVisible()
  await expect(page.locator('#rp-error')).toContainText(/at least 10 characters/i)
})
