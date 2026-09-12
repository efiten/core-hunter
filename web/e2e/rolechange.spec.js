import { test, expect } from './fixtures.js'

// Telling someone the wait ended (#530). The case that matters is the third
// one: a hunter waiting to be verified leaves the map open, and before this
// nothing re-read /api/auth/me, so the bar kept saying "Hunter view" however
// long ago an admin had acted.
const stub = async (page, roleRef) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: roleRef.role, username: 'u' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
}

test('a first visit records the role and says nothing', async ({ page }) => {
  const ref = { role: 'member' }
  await stub(page, ref)
  await page.goto('/')
  await expect(page.locator('#guest-notice')).toBeHidden()
  // Nothing stored yet, so a promotion cannot be told from an arrival. A member
  // of six months must not be congratulated on becoming one.
  await expect(page.locator('#role-notice')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-role-seen'))).toBe('member')
})

test('a hunter verified while the page is open is told, without touching anything', async ({ page }) => {
  const ref = { role: 'hunter' }
  await stub(page, ref)
  await page.goto('/')
  await expect(page.locator('#guest-notice')).toContainText('Hunter view')
  await expect(page.locator('#role-notice')).toBeHidden()

  // An admin verifies them. Nothing on this page is touched.
  ref.role = 'member'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect(page.locator('#role-notice')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('#role-notice')).toContainText('verified you as a member')
  // The standing notice has to go too, or the page says both things at once.
  await expect(page.locator('#guest-notice')).toBeHidden()
})

test('the notice is said once, not on every reload', async ({ page }) => {
  const ref = { role: 'hunter' }
  await stub(page, ref)
  await page.goto('/')
  ref.role = 'member'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#role-notice')).toBeVisible({ timeout: 10000 })
  await page.reload()
  await expect(page.locator('#map .maplibregl-canvas')).toBeVisible()
  await expect(page.locator('#role-notice')).toBeHidden()
})

test('it can be dismissed', async ({ page }) => {
  const ref = { role: 'guest' }
  await stub(page, ref)
  await page.goto('/')
  ref.role = 'hunter'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#role-notice')).toBeVisible({ timeout: 10000 })
  await page.locator('#role-notice-close').click()
  await expect(page.locator('#role-notice')).toBeHidden()
})

test('a demotion is not announced', async ({ page }) => {
  const ref = { role: 'member' }
  await stub(page, ref)
  await page.goto('/')
  ref.role = 'hunter'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // The standing notice reappears, which is how a reader learns it; a cheery
  // banner is the wrong way to hear it.
  await expect(page.locator('#guest-notice')).toContainText('Hunter view', { timeout: 10000 })
  await expect(page.locator('#role-notice')).toBeHidden()
})
