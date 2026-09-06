import { test, expect, openPicker } from './fixtures.js'

// The map's ignore-list (#494): the app has had one since it shipped, the map
// had none, and the API already accepted the filter.

const A = { lat: 51, lon: 4, rssi: -60, snr: 8, sender_id: 'aa11bb22', sender_label: 'NEO7HI',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', channel_name: '', packet_type: 'Advert', rx_at: '2026-07-22T14:59:55Z' }
const B = { ...A, sender_id: 'cc33dd44', sender_label: 'Charlie', rx_at: '2026-07-22T14:59:58Z' }

const ignoresOf = (u) => new URL(u).searchParams.getAll('ignores')

async function setup(page, { points = [A, B] } = {}) {
  const urls = []
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/heatmap*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { features: [] } }) })
  await page.route('**/api/points*', (r) => {
    urls.push(r.request().url())
    const ign = ignoresOf(r.request().url()).map((s) => s.toLowerCase())
    // The server drops ignored senders in SQL, so the mock has to as well --
    // otherwise the test would pass on a client-side filter that does not exist.
    return r.fulfill({ json: { points: points.filter((p) => !ign.includes(p.sender_id.toLowerCase())) } })
  })
  return urls
}

// Points render on a canvas with no per-marker DOM, so the popup is opened by
// clicking the map centre, where the fixture point sits (same technique as
// auth.spec.js).
async function openPointPopup(page) {
  await expect(async () => {
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.maplibregl-popup')).toBeVisible({ timeout: 1000 })
  }).toPass()
}

test('Ignore this ID drops the sender from the query, not just from the view', async ({ page }) => {
  const urls = await setup(page)
  // mode=both, because the point layer and the hex layer are separate requests
  // and the list has to reach both: the hex is what a visitor lands on (#141).
  await page.goto('/?mode=both')
  await openPointPopup(page)
  await page.locator('.pp-ignore').first().click()

  // The list travels as a repeated param, one id per value (#288), and it
  // reaches the hex layer too rather than only the point request.
  await expect.poll(() => urls.some((u) => u.includes('/api/points') && ignoresOf(u).length === 1)).toBe(true)
  await expect.poll(() => urls.some((u) => u.includes('/api/heatmap') && ignoresOf(u).length === 1)).toBe(true)
  await expect(page.locator('#status')).toContainText('1 ignored')
})

test('an ignored sender leaves the target picker', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await page.keyboard.press('Escape')

  await openPointPopup(page)
  await page.locator('.pp-ignore').first().click()

  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(1, { timeout: 10000 })
})

test('the settings list holds the ignored node, and Remove brings it back', async ({ page }) => {
  const urls = await setup(page)
  await page.goto('/?mode=points')
  await openPointPopup(page)
  await page.locator('.pp-ignore').first().click()

  await page.locator('#settings-btn').click()
  await expect(page.locator('#ss-ignore-list .ss-ignore-row')).toHaveCount(1)
  // Never the full id in the visible text; the id is in the title instead.
  const row = page.locator('#ss-ignore-list .ss-ignore-row .ss-ignore-key')
  await expect(row).not.toContainText('aa11bb22')
  await expect(row).toHaveAttribute('title', /aa11bb22|cc33dd44/)

  await page.locator('.ss-ignore-remove').click()
  await expect(page.locator('#ss-ignore-list .ss-ignore-row')).toHaveCount(0)
  await expect(page.locator('#ss-ignore-list')).toContainText('No ignored senders')
  await expect.poll(() => {
    const last = urls.filter((u) => u.includes('/api/points')).pop()
    return ignoresOf(last).length
  }).toBe(0)
})

test('the list survives a reload, and Clear empties it', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=points')
  await openPointPopup(page)
  await page.locator('.pp-ignore').first().click()
  await expect(page.locator('#status')).toContainText('1 ignored')

  // It lives in localStorage, deliberately not in the URL: a shared link must
  // not hide nodes for whoever opens it.
  await page.reload()
  await expect(page.locator('#status')).toContainText('1 ignored')
  expect(new URL(page.url()).searchParams.has('ignores')).toBe(false)

  await page.locator('#settings-btn').click()
  await page.locator('#ss-ignore-clear').click()
  await expect(page.locator('#ss-ignore-list')).toContainText('No ignored senders')
  await expect(page.locator('#status')).not.toContainText('ignored')
})

// The map's own ignore control (#494). The app reaches its list through
// Settings only; on the map the list is a picker like the other two, so a node
// can be silenced and brought back from the bar.
test('the ignore picker checks a node, and unchecks it again', async ({ page }) => {
  const urls = await setup(page)
  await page.goto('/?mode=points')
  await expect(page.locator('#ig-toggle')).toHaveText('Ignored ▾')

  await openPicker(page, '#ig-toggle', '#ignore-picker')
  await expect(page.locator('#ig-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await page.locator('#ig-list .tl-row', { hasText: 'NEO7HI' }).click()

  await expect(page.locator('#ig-toggle')).toHaveText('Ignored (1) ▾')
  await expect(page.locator('#ig-toggle')).toHaveClass(/has-selection/)
  // The class alone would prove nothing: `#bar select, #bar input, #bar button`
  // sets colour at (1,0,1), so a bare `.ms-toggle.has-selection` rule never
  // reaches this button. Measure what the button actually renders.
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ch-accent').trim())
  const n = parseInt(accent.replace('#', ''), 16)
  await page.keyboard.press('Escape')
  await expect(page.locator('#ignore-picker')).toBeHidden()
  expect(await page.locator('#ig-toggle').evaluate((el) => getComputedStyle(el).color))
    .toBe(`rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`)
  await openPicker(page, '#ig-toggle', '#ignore-picker')
  await expect.poll(() => urls.some((u) => u.includes('/api/points') && ignoresOf(u).includes('aa11bb22'))).toBe(true)

  // The candidate query for THIS picker drops the ignore-list, so the node it
  // just silenced is still listed, checked, and can be brought back. Every
  // other request has it filtered out by now.
  await expect(page.locator('#ig-list .tl-row')).toHaveCount(2)
  await expect(page.locator('#ig-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#ig-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#ig-toggle')).toHaveText('Ignored ▾')
  await expect.poll(() => {
    const last = urls.filter((u) => u.includes('/api/points')).pop()
    return ignoresOf(last).length
  }).toBe(0)
})

test('ignoring from the popup checks the row in the picker', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=points')
  await openPointPopup(page)
  await page.locator('.pp-ignore').first().click()

  // One list, three ways in (popup, picker, Settings): they cannot disagree.
  await expect(page.locator('#ig-toggle')).toHaveText('Ignored (1) ▾')
  await openPicker(page, '#ig-toggle', '#ignore-picker')
  await expect(page.locator('#ig-list .tl-row[aria-pressed="true"]')).toHaveCount(1, { timeout: 10000 })

  await page.locator('#settings-btn').click()
  await expect(page.locator('#ss-ignore-list .ss-ignore-row')).toHaveCount(1)
  // Named, not a bare hex prefix: the node was heard under a label in this
  // session, and a prefix names nothing to the person reading the list.
  // Which of the two fixture points the map centre hits is not the subject
  // here; that the row reads as a name plus a short prefix, rather than a bare
  // hex string, is.
  await expect(page.locator('#ss-ignore-list .ss-ignore-key')).toHaveText(/^(NEO7HI|Charlie) · [0-9a-f]{6}$/)
  await page.locator('.ss-ignore-remove').click()
  await expect(page.locator('#ig-toggle')).toHaveText('Ignored ▾')
})
