import { test, expect } from './fixtures.js'

test('non-admin is bounced from the admin page', async ({ page }) => {
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.goto('/admin.html')
  await expect(page.locator('body')).toContainText(/admin only/i)
})

test('admin sees the users table and can disable a user', async ({ page }) => {
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'admin', username: 'alice' } }))
  let patched = null
  await page.route('**/api/admin/users', async r => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ json: { users: [
        { id: 2, username: 'bob', email: 'b@x', role: 'hunter', status: 'active', companions: ['aa'], last_login_at: '2026-07-03T09:00:00Z' },
      ] } })
    }
    return r.fulfill({ json: { id: 3 } })
  })
  await page.route('**/api/admin/users/2', async r => { patched = r.request().postDataJSON(); return r.fulfill({ status: 204 }) })
  await page.goto('/admin.html')
  await expect(page.locator('#users-body tr')).toHaveCount(1)
  await expect(page.locator('#users-body')).toContainText('bob')
  await page.click('#users-body .row-actions button:has-text("Disable")')
  await expect.poll(() => patched && patched.status).toBe('disabled')
})

test('audit tab lists events newest-first', async ({ page }) => {
  await page.route('**/api/auth/me', r => r.fulfill({ json: { role: 'admin', username: 'alice' } }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: { users: [] } }))
  await page.route('**/api/admin/audit*', r => r.fulfill({ json: { events: [
    { id: 9, at: '2026-07-03T10:00:00Z', actor: 'alice', action: 'login', target: 'alice', ip: '1.2.3.4', details: '' },
  ] } }))
  await page.goto('/admin.html')
  await page.click('.tab-btn[data-tab="tab-audit"]')
  await expect(page.locator('#audit-list li')).toContainText('alice → login → alice (1.2.3.4)')
})
