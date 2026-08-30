import { test, expect, openPicker, clickClearFilters, setLayerMode } from './fixtures.js'

// Time-range picker (#285).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('the button labels the current range and the panel opens/closes', async ({ page }) => {
  await page.goto('/')
  // A cold start is the last 30 days (#492): long enough that a newcomer sees
  // what has been mapped, short enough that the server returns the whole
  // window rather than the newest 50 000 rows of it.
  await expect(page.locator('#tr-label')).toHaveText('Last 30 days')

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
  await clickClearFilters(page) // Clear lives in the filter panel (#539)
  await expect(page.locator('#tr-label')).toHaveText('00:00 → 23:59')
})

test('a guest is told what the clamp applies to (#300, #492, #493)', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.goto('/?from=now-7d&to=now')
  // The clamp is real and it is the ticker's: /api/points windows a sub-member
  // caller to 24 h, and since #493 the ticker is the only place they meet
  // individual receptions. The hex heat covers all 7 days (#466), so the note
  // names the strip it is true of rather than the whole range.
  await expect(page.locator('#tr-label')).toHaveText('Last 7 days (ticker: 24 h)')

  // The row is no longer hidden: a guest can pick 7 days, and on the layer the
  // map opens on that is exactly what they get.
  await openPicker(page, '#tr-toggle', '#time-picker')
  await expect(page.locator('.tr-item', { hasText: 'Last 7 days' })).toBeVisible()
  await expect(page.locator('.tr-item', { hasText: 'Last 30 days' })).toBeVisible()
})

test('a range inside the window carries no note (#492)', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.goto('/?from=now-6h&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 6 hours')
})

test('a member sees no clamp note for the same range (#300)', async ({ page }) => {
  await page.goto('/?mode=points&from=now-7d&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 7 days')
})

// #440's first impression, kept, with the promise corrected (#492). A newcomer
// used to get today only, which in most areas on most days is a blank map. An
// empty range fixed that and overshot: it reads as "All time", and
// /api/heatmap caps at the newest 50 000 rows in the bbox, so the button
// promised a history the server truncates without saying so. 30 days is a
// window the server returns whole.
test('a first visit asks for 30 days, and says so', async ({ page }) => {
  const heatmapUrls = []
  await page.route('**/api/heatmap*', (r) => { heatmapUrls.push(r.request().url()); r.fulfill({ json: { features: [] } }) })
  await page.goto('/')
  await expect(page.locator('#tr-label')).toHaveText('Last 30 days')

  // Tokens, not resolved timestamps: the window keeps rolling, and a link
  // built from this means "the last 30 days" to whoever opens it (#285).
  await expect(page.locator('#f-from')).toHaveValue('now-30d')
  await expect(page.locator('#f-to')).toHaveValue('now')

  await expect.poll(() => heatmapUrls.length).toBeGreaterThan(0)
  for (const u of heatmapUrls) {
    const from = new URL(u).searchParams.get('from') || ''
    expect(from, `heatmap request carried no from: ${u}`).not.toBe('')
    const days = (Date.now() - Date.parse(from)) / 86400000
    expect(days, `heatmap from is not ~30 days back: ${from}`).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  }
})

// Below member an empty range is not a state (#492): "all time" is the promise
// the 50 000-row cap cannot keep, so a link carrying no range lands on the same
// 30 days a cold start does.
test('a guest link with no range lands on 30 days', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.goto('/?mode=hex&from=&to=')
  // With the ticker note, since 30 days reaches past the 24 h it holds (#493).
  await expect(page.locator('#tr-label')).toHaveText('Last 30 days (ticker: 24 h)')
})

// A member keeps every range, the empty one included, but only as a range they
// are holding: an empty from/to is not stored (empty values fall out of the URL
// and out of storage), so it cannot be told apart from never having chosen. A
// fresh load therefore gets the cold-start 30 days whatever the role, and this
// pins the half that is real -- clearing the range leaves it cleared.
// The other half of "an empty range is not a state" (#492): a guest who empties
// both fields by hand and applies lands back on the cold-start window, rather
// than on an All time the 50 000-row cap cannot deliver.
test('a guest clearing both date fields lands back on 30 days', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.goto('/?mode=hex&from=now-6h&to=now')
  await expect(page.locator('#tr-label')).toHaveText('Last 6 hours')

  await openPicker(page, '#tr-toggle', '#time-picker')
  await page.locator('#tr-from').fill('')
  await page.locator('#tr-to').fill('')
  await page.locator('#tr-apply').click()
  await expect(page.locator('#tr-label')).toHaveText('Last 30 days (ticker: 24 h)')
})

test('a member can go back to all time and stays there', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#tr-label')).toHaveText('Last 30 days')
  await page.evaluate(() => {
    document.getElementById('f-from').value = ''
    document.getElementById('f-to').value = ''
    window.__syncTimeUi()
  })
  await expect(page.locator('#tr-label')).toHaveText('All time')
  // Nothing rewrites it underneath them on the next redraw.
  await setLayerMode(page, 'hex')
  await expect(page.locator('#tr-label')).toHaveText('All time')
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
  // #440's default was All time, which is not a relative token -- so the old
  // "is this range relative" test was false, the refresh timer was never
  // created, and the map showed whatever loaded on open. The receptions ticker
  // kept polling, so the page LOOKED alive while the map was frozen.
  //
  // The default is a token pair again since #492, which would have hidden that
  // bug rather than fixed it: rangeIsLive is what makes the timer independent
  // of how the range happens to be written, so this still pins it.
  let points = [pt(0), pt(1)]
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points } }))
  await page.goto('/?mode=points')
  await expect(page.locator('#tr-label')).toContainText('Last 30 days')
  // The points layer renders to a canvas, so there are no DOM markers to
  // count. The status line carries the number the map is actually showing,
  // which is what a hunter reads anyway.
  const status = page.locator('#status')
  await expect(status).toHaveText('2 points', { timeout: 10000 })
  // Six more arrive at the server. Nothing touches the map.
  points = [pt(0), pt(1), pt(2), pt(3), pt(4), pt(5), pt(6), pt(7)]
  await expect(status).toHaveText('8 points', { timeout: 25000 })
})

// #440 follow-up: "N cells (capped)" under a range button reading "All time" is
// a contradiction the reader cannot resolve. The truncation is the most RECENT
// n receptions, so the status line reports the date it reaches back to instead,
// and the mechanism lives in the title where there is room for it.
test('a truncated heatmap reports the date it reaches back to', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({
    json: {
      type: 'FeatureCollection',
      truncated: true,
      covers_from: '2026-08-12T09:14:00Z',
      features: [{
        type: 'Feature',
        properties: { cell: '10:1:1', count: 3, best_rssi: -80 },
        geometry: { type: 'Polygon', coordinates: [[[4, 51], [4.01, 51], [4.01, 51.01], [4, 51.01], [4, 51]]] },
      }],
    },
  }))
  await page.goto('/?mode=hex')
  const status = page.locator('#status')
  await expect(status).toContainText('since', { timeout: 10000 })
  // The vague warning is what this replaces, so its absence is the assertion.
  await expect(status).not.toContainText('(capped)')
  await expect(status).toHaveAttribute('title', /50,000 receptions/)
})
