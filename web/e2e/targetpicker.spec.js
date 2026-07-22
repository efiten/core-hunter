import { test, expect } from '@playwright/test'

// Target-list picker (#223) — browsable multi-select parity with app's target sheet.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

const A = { lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'aa11bb22', sender_label: 'NEO7HI', sender_role: 'Repeater',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', channel_name: '', packet_type: 'Advert', rx_at: '2026-07-22T14:59:55Z' }
const B = { ...A, sender_id: 'cc33dd44', sender_label: 'Charlie', rx_at: '2026-07-22T14:59:58Z' }

test('opening the picker lists senders from the currently loaded points', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B] } }))
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list')).toContainText('NEO7HI')
  await expect(page.locator('#tp-list')).toContainText('Charlie')
})

test('picking two senders writes a comma-joined id list to #f-sender and reaches the API on neither request (client-side filtered)', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A, B] } }) })
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#f-sender')).toHaveValue('aa11bb22')

  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  // Order isn't guaranteed (a Set, not a sorted list) -- assert membership.
  const value = await page.locator('#f-sender').inputValue()
  expect(value.split(',').sort()).toEqual(['aa11bb22', 'cc33dd44'])

  // The multi-id value must never be forwarded to the server's sender= param
  // (it can only do a single leading-prefix LIKE match) -- assert no request
  // after both picks carries the comma-joined value.
  await expect.poll(() => urls.some((u) => u.includes('sender=aa11bb22%2Ccc33dd44') || u.includes('sender=aa11bb22,cc33dd44'))).toBe(false)
})

test('picking both senders narrows the map to exactly those two points', async ({ page }) => {
  const C = { ...A, sender_id: 'ee55ff66', sender_label: 'Echo', rx_at: '2026-07-22T15:00:00Z' }
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B, C] } }))
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(3, { timeout: 10000 })

  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  await expect(page.locator('#status')).toHaveText('2 points', { timeout: 10000 })
})

test('a picked row shows checked state, and unpicking it restores the plain count', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B] } }))
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  const row = page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#f-sender')).toHaveValue('')
})

test('closes on outside click and on Escape', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A] } }))
  await page.goto('/?mode=points')

  await page.click('#sp-toggle')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await page.mouse.click(10, 300) // well outside the popover
  await expect(page.locator('#sender-picker')).toBeHidden()

  await page.click('#sp-toggle')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#sender-picker')).toBeHidden()
})

test('the plain text prefix search still works unchanged (single value, no comma)', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A] } }) })
  await page.goto('/?mode=points')
  await page.fill('#f-sender', 'aa11')
  await expect.poll(() => urls.some((u) => u.includes('sender=aa11') && !u.includes(','))).toBe(true)
})
