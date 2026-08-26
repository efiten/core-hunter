import { test, expect } from './fixtures.js'

// The chips live in a popover (#bar wraps by content width and a sixth inline
// row pushes the walkthrough into its fallback), so every case opens it first.
const openClasses = async (page) => {
  await page.locator('#f-idclass-toggle').click()
  await expect(page.locator('#f-idclass')).toBeVisible()
}

// Sender-id classes (#475). The class that isolates a flood moved: before #521
// those receptions had no sender, so `Sender unknown` caught them; they carry a
// byte now and nothing did. These pin the whole chain -- chip, query param,
// URL -- because the bucketing itself lives in three places (app JS, web JS,
// server SQL) and only the param proves the web half reaches the server.
const base = { lat: 51, lon: 4, rssi: -90, snr: -8, hops: 4, hunter_pubkey: 'h1', hunter_name: 'H',
  channel_name: '', packet_type: 'TextMessage', rx_at: '2026-08-26T10:00:00Z' }
const FLOOD = { ...base, sender_id: '77', sender_label: '77', sender_kind: 'path_hash' }
const RELAY = { ...base, sender_id: 'a2a2', sender_label: '', sender_kind: 'relay', rx_at: '2026-08-26T10:01:00Z' }

const idclassOf = (u) => new URL(u).searchParams.get('idclass')

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { name: '', ambiguous: true } }))
})

test('picking a class sends it to the server and narrows the map', async ({ page }) => {
  const urls = []
  // The mock honours the param the way the server does, so the status line is
  // evidence the filter reached the data rather than only the address bar.
  await page.route('**/api/points*', (r) => {
    const cls = idclassOf(r.request().url())
    urls.push(cls)
    const all = [FLOOD, RELAY]
    const want = new Set((cls || '').split(',').filter(Boolean))
    const rows = want.size ? all.filter((p) => want.has(p.sender_id.length === 2 ? '1b' : '2b')) : all
    return r.fulfill({ json: { points: rows } })
  })
  await page.goto('/?mode=points')
  const status = page.locator('#status')
  await expect(status).toHaveText('2 points', { timeout: 10000 })

  await openClasses(page)
  await page.locator('#f-idclass .f-chip', { hasText: '1 byte' }).click()
  await expect(status).toHaveText('1 points', { timeout: 10000 })
  await expect.poll(() => urls.some((u) => u === '1b')).toBe(true)
})

test('several chips are a union, and none means no filter', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => {
    urls.push(idclassOf(r.request().url()))
    return r.fulfill({ json: { points: [FLOOD, RELAY] } })
  })
  await page.goto('/?mode=points')
  await expect(page.locator('#status')).toHaveText('2 points', { timeout: 10000 })
  await openClasses(page)
  await page.locator('#f-idclass .f-chip', { hasText: '1 byte' }).click()
  await page.locator('#f-idclass .f-chip', { hasText: '2 bytes' }).click()
  await expect.poll(() => urls.some((u) => u === '1b,2b')).toBe(true)
  // Untick both: the param goes away rather than becoming an empty filter that
  // matches nothing.
  await page.locator('#f-idclass .f-chip', { hasText: '1 byte' }).click()
  await page.locator('#f-idclass .f-chip', { hasText: '2 bytes' }).click()
  await expect.poll(() => urls.at(-1) === '' || urls.at(-1) === null).toBe(true)
})

test('a picked class survives a reload, so a shared link carries it', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [FLOOD] } }))
  await page.goto('/?mode=points')
  await openClasses(page)
  await page.locator('#f-idclass .f-chip', { hasText: '1 byte' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('idclass')).toBe('1b')
  await page.reload()
  // The toggle carries the state while the chips are out of sight, which is the
  // only signal a reader has that the map is narrowed.
  await expect(page.locator('#f-idclass-toggle')).toHaveClass(/active/, { timeout: 10000 })
  await openClasses(page)
  await expect(page.locator('#f-idclass .f-chip.active', { hasText: '1 byte' })).toBeVisible()
})
