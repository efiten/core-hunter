import { test, expect, openPicker } from './fixtures.js'

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
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list')).toContainText('NEO7HI')
  await expect(page.locator('#tp-list')).toContainText('Charlie')
})

const sendersOf = (u) => new URL(u).searchParams.getAll('senders')

test('a picked selection is sent to the server as repeated senders= params', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A, B] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  // One id per senders= param, so an id is never delimiter-joined and any
  // punctuation in it survives verbatim. #f-sender is now purely the typed
  // prefix box and holds no part of the selection.
  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#f-sender')).toHaveValue('')
  await expect.poll(() => urls.some((u) => sendersOf(u).join() === 'aa11bb22')).toBe(true)

  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  await expect.poll(() => urls.some((u) => sendersOf(u).slice().sort().join() === 'aa11bb22,cc33dd44')).toBe(true)
})

test('the picker keeps listing every candidate sender after one is picked', async ({ page }) => {
  // Regression guard: the picker's candidate query must drop `sender`. With
  // the server now applying the filter for real, feeding it the map's own
  // (already narrowed) result set would shrink the list to the current
  // selection and make picking a second sender impossible.
  await page.route('**/api/points*', (r) => {
    const ids = sendersOf(r.request().url()).map((s) => s.toLowerCase())
    const all = [A, B]
    const points = ids.length ? all.filter((p) => ids.includes(p.sender_id.toLowerCase())) : all
    return r.fulfill({ json: { points } })
  })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })

  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect(page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'true')
  // Both rows still offered, and the unpicked one is still clickable.
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2)
  await page.locator('#tp-list .tl-row', { hasText: 'Charlie' }).click()
  await expect(page.locator('#tp-list .tl-row', { hasText: 'Charlie' })).toHaveAttribute('aria-pressed', 'true')
})

test('a single pick survives a reload as a pick, not a prefix search', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B] } }))
  // The selection persists as JSON, since a sender_id is arbitrary operator
  // text that cannot be delimiter-joined (#288).
  await page.goto('/?mode=points&senders=' + encodeURIComponent('["aa11bb22"]'))
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'true')
  // ...whereas the same id typed into the prefix box is a search, not a pick.
  // Drop the stored selection first: it is a persisted filter, so it would
  // otherwise be restored on the next load and mask what is being asserted.
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?mode=points&sender=aa11bb22')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' })).toHaveAttribute('aria-pressed', 'false')
})

test('Clear also clears the pick, not just the typed prefix', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A, B] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect.poll(() => urls.some((u) => sendersOf(u).length === 1)).toBe(true)

  urls.length = 0
  // Close the panel first: it is a popover in the same bar, so with #285's
  // time-range control alongside it, an open panel overlays the Clear button.
  await page.keyboard.press('Escape')
  await expect(page.locator('#sender-picker')).toBeHidden()
  await page.click('#clear-filters')
  // The pick lives in the picker, not in #f-sender, so Clear has to reach it —
  // otherwise the filter survives with no visible trace of why.
  await expect.poll(() => urls.length > 0 && urls.every((u) => sendersOf(u).length === 0)).toBe(true)
})

test('a picked row shows checked state, and unpicking it restores the plain count', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [A, B] } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
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

  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await page.mouse.click(10, 300) // well outside the popover
  await expect(page.locator('#sender-picker')).toBeHidden()

  await openPicker(page, '#sp-toggle', '#sender-picker')
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

test('senders past the first page are reachable on a tall viewport (#298)', async ({ page }) => {
  // The list is capped in px, not vh, so it always overflows past one page and
  // the scroll handler can fire. With a vh-only cap this viewport is tall
  // enough that it never overflows and these rows are unreachable.
  await page.setViewportSize({ width: 1280, height: 1600 })
  const many = Array.from({ length: 30 }, (_, i) => ({
    ...A,
    sender_id: 'aa' + String(i).padStart(6, '0'),
    sender_label: 'Node-' + String(i).padStart(2, '0'),
    rx_at: `2026-07-22T14:${String(i).padStart(2, '0')}:00Z`,
  }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: many } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(12, { timeout: 10000 })

  const list = page.locator('#tp-list')
  await expect(list).toHaveJSProperty('scrollHeight', await list.evaluate((el) => el.scrollHeight))
  const overflows = await list.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(overflows).toBe(true)   // the precondition the lazy load depends on

  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(24, { timeout: 10000 })
})

// Prefix merging (#331): the same node was listed once per prefix it was heard
// under (a 2-byte relay path hash, a 3-byte discover prefix, the full pubkey).
const FULL = '4a4abe' + '11'.repeat(29)
const ADV = { ...A, sender_id: FULL, sender_label: '', sender_kind: 'advert_pubkey', rx_at: '2026-07-22T14:59:50Z' }
const HOP = { ...ADV, sender_id: '4a4a', sender_kind: 'relay', rx_at: '2026-07-22T14:59:59Z' }

test('one row per node, and picking it filters on every prefix it is known by', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [ADV, HOP, B] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  // Two nodes, not three rows: the advert and its path hash are one node.
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  // The id stays visible, and it is the node's own key, not the path hash.
  const merged = page.locator('#tp-list .tl-row', { hasText: '4a4abe' })
  await expect(merged).toHaveCount(1)

  // One click selects the group, so a later reception under either prefix still
  // counts as the same target.
  await merged.click()
  await expect(merged).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => urls.some((u) => sendersOf(u).slice().sort().join() === ['4a4a', FULL].sort().join())).toBe(true)

  // ...and one more click releases the whole group.
  urls.length = 0
  await merged.click()
  await expect(merged).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => urls.length > 0 && urls.every((u) => sendersOf(u).length === 0)).toBe(true)
})

test('typing a prefix clears an active pick instead of being ignored (#299)', async ({ page }) => {
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [A, B] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await page.locator('#tp-list .tl-row', { hasText: 'NEO7HI' }).click()
  await expect.poll(() => urls.some((u) => sendersOf(u).length === 1)).toBe(true)

  urls.length = 0
  await page.fill('#f-sender', 'cc33')
  // The typed prefix now reaches the server, and the pick is gone rather than
  // silently overriding it.
  await expect.poll(() => urls.some((u) => new URL(u).searchParams.get('sender') === 'cc33')).toBe(true)
  await expect.poll(() => urls.every((u) => sendersOf(u).length === 0)).toBe(true)
})

// The rows the map already has, but with no server-side label: exactly what a
// relay path hash looks like. The name has to come from the resolver, and
// before #525 the picker never asked for one, so every such row read
// "(name not resolved)" while the same node showed its name in a point popup.
const UNNAMED = { ...A, sender_id: '4a4abe', sender_label: '', sender_kind: 'relay' }
const HASH = { ...A, sender_id: '77', sender_label: '77', sender_kind: 'direct_hash',
  rx_at: '2026-07-22T14:59:59Z' }

test('a row with no label takes its name from the resolver', async ({ page }) => {
  const asked = []
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [UNNAMED] } }))
  await page.route('**/api/resolve*', (r) => {
    asked.push(new URL(r.request().url()).searchParams.get('prefix'))
    return r.fulfill({ json: { prefix: '4a4abe', name: 'BE-MGU-RP01', ambiguous: false } })
  })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('#tp-list')).toContainText('BE-MGU-RP01', { timeout: 10000 })
  await expect(page.locator('#tp-list')).not.toContainText('name not resolved')
  expect(asked).toContain('4a4abe')
})

test('an ambiguous prefix keeps the marker instead of guessing a name', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [UNNAMED] } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { prefix: '4a4abe', name: '', ambiguous: true } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('#tp-list')).toContainText('name not resolved')
})

test('a 1-byte id is marked, and never sent to the resolver', async ({ page }) => {
  const asked = []
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [HASH] } }))
  await page.route('**/api/resolve*', (r) => {
    asked.push(new URL(r.request().url()).searchParams.get('prefix'))
    return r.fulfill({ json: { name: 'should never be used', ambiguous: false } })
  })
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('#tp-list')).toContainText('#77')
  await expect(page.locator('#tp-list')).not.toContainText('should never be used')
  expect(asked).toEqual([])
})
