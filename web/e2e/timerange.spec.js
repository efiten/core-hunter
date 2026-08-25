import { test, expect, openPicker } from './fixtures.js'

// Time-range picker (#285).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('the button labels the current range and the panel opens/closes', async ({ page }) => {
  await page.goto('/')
  // A cold start is now unbounded (#440): the map opens on everything that has
  // been mapped rather than on however many hours have passed since local
  // midnight. rangeLabel already had a word for an empty range.
  await expect(page.locator('#tr-label')).toHaveText('All time')

  await openPicker(page, '#tr-toggle', '#time-picker')
  await expect(page.locator('#tr-quick .tr-item')).toHaveCount(12)
  await page.keyboard.press('Escape')
  await expect(page.locator('#time-picker')).toBeHidden()
})

test('picking a quick range stores the token, relabels, and requeries a resolved window', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#tr-toggle', '#time-picker')
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
  await openPicker(page, '#tr-toggle', '#time-picker')
  await expect(page.locator('#tr-quick .tr-item.active')).toHaveText('Last 1 hour')
})

test('the absolute panel pre-fills from a token and Apply switches to an absolute range', async ({ page }) => {
  await page.goto('/?mode=points&from=now-1h&to=now')
  await openPicker(page, '#tr-toggle', '#time-picker')
  // datetime-local cannot show a token, so the fields show what it resolves to.
  await expect(page.locator('#tr-from')).not.toHaveValue('')
  await expect(page.locator('#tr-from')).not.toHaveValue('now-1h')

  await page.fill('#tr-from', '2026-07-20T08:00')
  await page.fill('#tr-to', '2026-07-20T09:30')
  await page.click('#tr-apply')
  await expect(page.locator('#time-picker')).toBeHidden()
  await expect(page.locator('#tr-label')).toHaveText('2026-07-20 08:00 → 2026-07-20 09:30')
  // Apply stores the resolved instant, so the URL carries UTC. The browser is
  // pinned to Europe/Brussels (playwright.config.js), so 08:00 local is 06:00Z
  // in July — deterministic, and it asserts the conversion rather than echoing
  // it. Computing this in Node instead would read the *runner's* zone and pass
  // only on a UTC machine, which is the trap this replaces.
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe('2026-07-20T06:00:00.000Z')
})

test('copy absolute link freezes the range to timestamps', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?mode=points&from=now-1h&to=now')
  await openPicker(page, '#tr-toggle', '#time-picker')
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

test('a guest is told the range is clamped, not just shown a hidden row (#300)', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.goto('/?mode=points&from=now-7d&to=now')
  // Hiding the >24h quick ranges stops a guest picking one, but a shared link
  // still lands here — and the server clamps to 24h regardless.
  await expect(page.locator('#tr-label')).toHaveText('Last 7 days (24 h max)')
  await openPicker(page, '#tr-toggle', '#time-picker')
  await expect(page.locator('.tr-item', { hasText: 'Last 7 days' })).toBeHidden()
})

test('a member sees no clamp note for the same range (#300)', async ({ page }) => {
  await page.goto('/?mode=points&from=now-7d&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 7 days')
})

// #440: the map's first impression. A newcomer landing on mesh-hunter.eu used
// to get today only -- at 09:00 that is nine hours of driving, and in most
// areas on most days a blank map, which is the worst possible advertisement for
// a mapping project. The server stopped clamping the guest heatmap, but that
// alone changes nothing while the client still asks for today, so this pins the
// half that actually reaches the API.
test('a first visit asks for all coverage, not just today', async ({ page }) => {
  const heatmapUrls = []
  await page.route('**/api/heatmap*', (r) => { heatmapUrls.push(r.request().url()); r.fulfill({ json: { features: [] } }) })
  await page.goto('/')
  await expect(page.locator('#tr-label')).toHaveText('All time')

  // The inputs are left empty rather than filled with midnight..23:59.
  await expect(page.locator('#f-from')).toHaveValue('')
  await expect(page.locator('#f-to')).toHaveValue('')

  await expect.poll(() => heatmapUrls.length).toBeGreaterThan(0)
  for (const u of heatmapUrls) {
    const q = new URL(u).searchParams
    expect(q.get('from') || '', `heatmap request carried a from: ${u}`).toBe('')
  }
})

// The other half of the same rule: a returning visitor keeps whatever range
// they last used. defaultToday only fills a range nothing restored, so this
// must not be re-broadened underneath them.
test('a restored range survives the all-time default', async ({ page }) => {
  await page.goto('/?from=now-6h')
  // Open-ended, and it stays open-ended: nothing invents a `to` to pair with a
  // shared link that carried only a `from`.
  await expect(page.locator('#tr-label')).toHaveText('From now-6h')
  await expect(page.locator('#f-from')).toHaveValue('now-6h')
  await expect(page.locator('#f-to')).toHaveValue('')
})
const pt = (i) => ({ lat: 52.36 + i * 2e-4, lon: 4.83, rssi: -90, snr: -5, hops: 0,
  sender_id: 'aa', sender_kind: 'relay', sender_label: '', hunter_name: 'Onnix',
  packet_type: 'TextMessage', rx_at: '2026-08-24T20:57:00Z' })
test('new receptions appear on the map without touching it', async ({ page }) => {
  // The default range since #440 is All time, which is not a relative token --
  // so the old "is this range relative" test was false, the refresh timer was
  // never created, and the map showed whatever loaded on open. The receptions
  // ticker kept polling, so the page LOOKED alive while the map was frozen.
  let points = [pt(0), pt(1)]
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points } }))
  await page.goto('/?mode=points')
  await expect(page.locator('#tr-label')).toContainText('All time')
  // The points layer renders to a canvas, so there are no DOM markers to
  // count. The status line carries the number the map is actually showing,
  // which is what a hunter reads anyway.
  const status = page.locator('#status')
  await expect(status).toHaveText('2 points', { timeout: 10000 })
  // Six more arrive at the server. Nothing touches the map.
  points = [pt(0), pt(1), pt(2), pt(3), pt(4), pt(5), pt(6), pt(7)]
  await expect(status).toHaveText('8 points', { timeout: 25000 })
})
