import { test, expect, openPicker } from './fixtures.js'

// Hunter picker (#290) — generalizes the #223 target-list picker pattern to
// #f-hunter's role: browsable multi-select parity, replacing the native
// <select multiple>.

test.beforeEach(async ({ page }) => {
  // The picker's selection is a persisted filter (urlstate -> localStorage), so
  // a pick made in one navigation is restored on the next. Start every test from
  // a clean store, otherwise assertions depend on whether save() happened to run
  // before the following goto.
  await page.addInitScript(() => { try { localStorage.clear() } catch (_) {} })
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
})

const H1 = { hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 42 }
const H2 = { hunter_pubkey: 'def456abc123', hunter_name: 'ON7BE', count: 7 }

test('opening the picker lists hunters from /api/hunters', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1, H2] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hunter-picker')).toBeVisible()
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(2)
  await expect(page.locator('#hp-list')).toContainText('ON8AR (42)')
  await expect(page.locator('#hp-list')).toContainText('ON7BE (7)')
})

const hunterOf = (u) => new URL(u).searchParams.get('hunter')

test('a picked selection reaches the server as a comma-separated hunter= param', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1, H2] } }))
  const urls = []
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(2)

  await page.locator('#hp-list .tl-row', { hasText: 'ON8AR' }).click()
  await expect.poll(() => urls.some((u) => hunterOf(u) === 'abc123def456')).toBe(true)

  await page.locator('#hp-list .tl-row', { hasText: 'ON7BE' }).click()
  await expect.poll(() => urls.some((u) => hunterOf(u) === 'abc123def456,def456abc123')).toBe(true)
  await expect(page).toHaveURL(/hunter=abc123def456%2Cdef456abc123/)
})

test('the picker keeps listing every candidate hunter after one is picked', async ({ page }) => {
  // Regression guard, mirrors the sender picker's #288 precedent: the Top
  // section's candidate query must drop the hunter filter, so an already-
  // picked hunter doesn't hide a newly-relevant one from the ranking, and the
  // main list must stay the full roster regardless of selection.
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1, H2] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(2)

  await page.locator('#hp-list .tl-row', { hasText: 'ON8AR' }).click()
  await expect(page.locator('#hp-list .tl-row', { hasText: 'ON8AR' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(2)
  await page.locator('#hp-list .tl-row', { hasText: 'ON7BE' }).click()
  await expect(page.locator('#hp-list .tl-row', { hasText: 'ON7BE' })).toHaveAttribute('aria-pressed', 'true')
})

test('the Top section ranks by most recent activity, not highest count', async ({ page }) => {
  // Both hunters have candidate-point activity, so both get pinned (the
  // default pin count is 3) -- the point of this test is the ORDER: Fresh
  // (count 1, heard moments ago) must rank ahead of Stale (count 999, heard
  // years ago), since a hunter has no signal-strength concept to rank by.
  const stale = { hunter_pubkey: 'stale111111', hunter_name: 'Stale', count: 999 }
  const fresh = { hunter_pubkey: 'fresh222222', hunter_name: 'Fresh', count: 1 }
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [stale, fresh] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [
    { lat: 51, lon: 4, rssi: -80, hunter_pubkey: 'stale111111', rx_at: '2020-01-01T00:00:00Z' },
    { lat: 51, lon: 4, rssi: -80, hunter_pubkey: 'fresh222222', rx_at: new Date().toISOString() },
  ] } }))
  await page.goto('/?mode=points')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hp-pinned .tl-row')).toHaveCount(2, { timeout: 10000 })
  const pinnedNames = await page.locator('#hp-pinned .tl-name').allTextContents()
  expect(pinnedNames[0]).toContain('Fresh')
  expect(pinnedNames[1]).toContain('Stale')
})

test('a shared URL with multiple hunters restores the selection (#196)', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1, H2] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points&hunter=abc123def456,def456abc123')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(2)
  await expect(page.locator('#hp-list .tl-row', { hasText: 'ON8AR' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#hp-list .tl-row', { hasText: 'ON7BE' })).toHaveAttribute('aria-pressed', 'true')
})

test('Clear also clears the hunter selection', async ({ page }) => {
  const urls = []
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1] } }))
  await page.route('**/api/points*', (r) => { urls.push(r.request().url()); return r.fulfill({ json: { points: [] } }) })
  await page.goto('/?mode=points')
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hp-list .tl-row')).toHaveCount(1)
  await page.locator('#hp-list .tl-row', { hasText: 'ON8AR' }).click()
  await expect.poll(() => urls.some((u) => hunterOf(u) === 'abc123def456')).toBe(true)

  urls.length = 0
  await page.keyboard.press('Escape')
  await expect(page.locator('#hunter-picker')).toBeHidden()
  await page.click('#clear-filters')
  await expect.poll(() => urls.length > 0 && urls.every((u) => !hunterOf(u))).toBe(true)
  await expect(page).not.toHaveURL(/hunter=/)
})

test('closes on outside click and on Escape', async ({ page }) => {
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')

  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hunter-picker')).toBeVisible()
  await page.mouse.click(10, 300) // well outside the popover
  await expect(page.locator('#hunter-picker')).toBeHidden()

  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hunter-picker')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#hunter-picker')).toBeHidden()
})

test('opening the hunter picker closes an already-open sender picker (distinct .ms-wrap wrappers)', async ({ page }) => {
  // Regression guard: both pickers share the .ms-wrap wrapper class (#290).
  // wirePopover's outside-click check must scope to each control's own wrap
  // element, not just any element matching the shared class -- otherwise a
  // click inside one picker would be misread as "inside" the other picker's
  // wrap too, and neither would ever close on the other's clicks.
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [H1] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')

  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#sender-picker')).toBeVisible()
  await openPicker(page, '#hp-toggle', '#hunter-picker')
  await expect(page.locator('#hunter-picker')).toBeVisible()
  await expect(page.locator('#sender-picker')).toBeHidden()
})
