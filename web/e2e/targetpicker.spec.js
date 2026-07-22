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

test('a picked selection is sent to the server as a real sender= filter', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A, B] } }) })
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  // One pick -> trailing comma, so it stays an exact-id selection rather than
  // decaying into a prefix search (the server reads the comma the same way).
  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#f-sender')).toHaveValue('aa11bb22,')
  await expect.poll(() => urls.some((u) => /sender=aa11bb22(%2C|,)(&|$)/.test(u))).toBe(true)

  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  const value = await page.locator('#f-sender').inputValue()
  expect(value.split(',').filter(Boolean).sort()).toEqual(['aa11bb22', 'cc33dd44'])
  // The multi-id value now DOES reach the server -- it applies it as a real
  // SQL IN filter, so the client no longer post-filters anything.
  await expect.poll(() => urls.some((u) => /sender=aa11bb22(%2C|,)cc33dd44/.test(u))).toBe(true)
})

test('the picker keeps listing every candidate sender after one is picked', async ({ page }) => {
  // Regression guard: the picker's candidate query must drop `sender`. With
  // the server now applying the filter for real, feeding it the map's own
  // (already narrowed) result set would shrink the list to the current
  // selection and make picking a second sender impossible.
  await page.route('**/api/points*', (r) => {
    const sender = new URL(r.request().url()).searchParams.get('sender')
    const all = [A, B]
    const ids = (sender || '').split(',').filter(Boolean).map((s) => s.toLowerCase())
    const points = ids.length ? all.filter((p) => ids.includes(p.sender_id.toLowerCase())) : all
    return r.fulfill({ json: { points } })
  })
  await page.goto('/?mode=points')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#f-sender')).toHaveValue('aa11bb22,')
  // Both rows still offered, and the unpicked one is still clickable.
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2)
  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  const value = await page.locator('#f-sender').inputValue()
  expect(value.split(',').filter(Boolean).sort()).toEqual(['aa11bb22', 'cc33dd44'])
})

test('a single pick survives a reload as a pick, not a prefix search', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B] } }))
  await page.goto('/?mode=points&sender=aa11bb22,')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'true')
  // ...whereas a comma-less value is still a plain prefix search: not a pick.
  await page.goto('/?mode=points&sender=aa11bb22')
  await page.click('#sp-toggle')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'false')
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
