import { test, expect } from '@playwright/test'

// Time-range picker (#285).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('the button labels the current range and the panel opens/closes', async ({ page }) => {
  await page.goto('/')
  // Cold default is still today 00:00-23:59 (#217 untouched), so the label is
  // the absolute span rather than a quick-range name.
  await expect(page.locator('#tr-label')).toHaveText('00:00 → 23:59')

  await page.click('#tr-toggle')
  await expect(page.locator('#time-picker')).toBeVisible()
  await expect(page.locator('#tr-quick .tr-item')).toHaveCount(12)
  await page.keyboard.press('Escape')
  await expect(page.locator('#time-picker')).toBeHidden()
})

test('picking a quick range stores the token, relabels, and requeries a resolved window', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [] } }) })
  await page.goto('/?mode=points')
  await page.click('#tr-toggle')
  await page.locator('#tr-quick button', { hasText: 'Last 6 hours' }).click()

  await expect(page.locator('#tr-label')).toHaveText('Last 6 hours')
  // The URL carries the TOKEN, not a resolved timestamp — that is what makes a
  // shared link keep meaning "the last 6 hours" for whoever opens it.
  await expect(page).toHaveURL(/from=now-6h/)
  await expect(page).toHaveURL(/to=now/)
  // ...while the API still receives concrete ISO timestamps.
  await expect.poll(() => urls.some((u) => /from=\d{4}-\d{2}-\d{2}T/.test(u) && !u.includes('now-6h'))).toBe(true)
})

test('a token range in the URL is restored and resolved on load', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [] } }) })
  await page.goto('/?mode=points&from=now-1h&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 1 hour')
  await expect.poll(() => urls.some((u) => /from=\d{4}-\d{2}-\d{2}T/.test(u))).toBe(true)
  // The active quick range is marked in the list.
  await page.click('#tr-toggle')
  await expect(page.locator('#tr-quick .tr-item.active')).toHaveText('Last 1 hour')
})

test('the absolute panel pre-fills from a token and Apply switches to an absolute range', async ({ page }) => {
  await page.goto('/?mode=points&from=now-1h&to=now')
  await page.click('#tr-toggle')
  // datetime-local cannot show a token, so the fields show what it resolves to.
  await expect(page.locator('#tr-from')).not.toHaveValue('')
  await expect(page.locator('#tr-from')).not.toHaveValue('now-1h')

  await page.fill('#tr-from', '2026-07-20T08:00')
  await page.fill('#tr-to', '2026-07-20T09:30')
  await page.click('#tr-apply')
  await expect(page.locator('#time-picker')).toBeHidden()
  await expect(page.locator('#tr-label')).toHaveText('2026-07-20 08:00 → 2026-07-20 09:30')
  await expect(page).toHaveURL(/from=2026-07-20T08%3A00/)
})

test('copy absolute link freezes the range to timestamps', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?mode=points&from=now-1h&to=now')
  await page.click('#tr-toggle')
  await page.click('#tr-copy')
  await expect(page.locator('#tr-copy')).toHaveText('Copied!')

  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).not.toContain('now-1h')
  expect(copied).toMatch(/from=\d{4}-\d{2}-\d{2}T/)
  // The stored range itself is untouched — copying is a share action, not a change.
  await expect(page).toHaveURL(/from=now-1h/)
})

test('Clear resets the range back to today and relabels', async ({ page }) => {
  await page.goto('/?mode=points&from=now-6h&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 6 hours')
  await page.click('#clear-filters')
  await expect(page.locator('#tr-label')).toHaveText('00:00 → 23:59')
})
