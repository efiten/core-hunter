import { test, expect } from './fixtures.js'

// #630: the map's controls are one FAB rail at the bottom right, modelled on
// the app's: zoom in, zoom out, compass, 2D/3D and node positions. That every
// button can be reached at every width is pinned in barlayout.spec.js; this
// file pins what each press does.

const zoom = (page) => page.evaluate(() => window.__mapZoom())
const bearing = (page) => page.evaluate(() => window.__mapBearing())
const pitch = (page) => page.evaluate(() => window.__mapPitch())

// A role that can change while the page is open: the focus re-check (#530)
// re-reads /api/auth/me, the path a login elsewhere or a verification takes.
const stub = async (page, ref) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: ref.role, username: 'u' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [] } }))
  await page.route('**/api/observer-points*', (r) => r.fulfill({ json: { points: [] } }))
}
const recheckRole = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))

test('the zoom buttons zoom one level each way', async ({ page }) => {
  await page.goto('/?lat=51&lon=4&z=10')
  await expect.poll(() => zoom(page)).toBe(10)
  await page.click('#zoom-in')
  await expect.poll(() => zoom(page)).toBe(11)
  await page.click('#zoom-out')
  await expect.poll(() => zoom(page)).toBe(10)
})

// Disabled at the exact bound, where a press would do nothing, and enabled
// again as soon as the map leaves it: the buttons repaint on every zoom.
test('zoom in is disabled at the maximum zoom, and comes back one level out', async ({ page }) => {
  await page.goto('/?lat=51&lon=4&z=23') // the URL's zoom is MapLibre's plus one: 22, the max
  await expect(page.locator('#zoom-in')).toBeDisabled()
  await expect(page.locator('#zoom-out')).toBeEnabled()
  await page.click('#zoom-out')
  await expect(page.locator('#zoom-in')).toBeEnabled()
  await expect.poll(() => zoom(page)).toBe(22)
})

// MapLibre's minimum zoom (-2) draws the world 128px tall, and the map will
// not zoom out past a world that fills its height. So only a map shorter than
// that can reach the bound, which is why this window is 170px tall.
test('zoom out is disabled at the minimum zoom, and comes back one level in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 170 })
  await page.goto('/?lat=0&lon=0&z=-1')
  await expect(page.locator('#zoom-out')).toBeDisabled()
  await expect(page.locator('#zoom-in')).toBeEnabled()
  await page.locator('#zoom-in').evaluate((b) => b.click()) // the rail runs off the top of a window this short
  await expect(page.locator('#zoom-out')).toBeEnabled()
  await expect.poll(() => zoom(page)).toBe(0)
})

// A press turns the map to north and nothing else: flattening a 3D view is the
// view button's job. The needle turns against the bearing, so it keeps
// pointing at north on screen, and it does not tilt with the pitch.
test('the compass turns the map to north and keeps the pitch, and its needle follows the bearing', async ({ page }) => {
  await page.goto('/?view=3d&pitch=45&bearing=30')
  await page.waitForFunction(() => Math.round(window.__mapBearing()) === 30)
  const needle = () => page.locator('#compass-needle').evaluate((el) => el.style.transform)
  expect(await needle()).toBe('rotate(-30deg)')

  await page.click('#compass-btn')
  await page.waitForFunction(() => Math.round(window.__mapBearing()) === 0)
  expect(Math.round(await pitch(page)), 'the compass flattened the map').toBe(45)
  await expect(page.locator('#view-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page).not.toHaveURL(/[?&]bearing=/)
  await expect(page).toHaveURL(/[?&]pitch=45/)
  expect(Math.abs(Math.round(await bearing(page)))).toBe(0)
  expect(await needle()).toMatch(/^rotate\(-?0deg\)$/)
})

// The app's three stops under the app's labels, with the ring filled up to the
// stop (fabring.js) and the accent ring when on.
test('a member taps the node-positions button through off, positions and reach, and back to off', async ({ page }) => {
  await stub(page, { role: 'member' })
  await page.goto('/')
  const fab = page.locator('#nodepos-toggle')
  const lit = () => fab.evaluate((el) => el.querySelectorAll('.fab-ring circle[stroke="var(--ch-accent)"]').length)
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: off')
  expect(await lit()).toBe(0)

  await fab.click()
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: advertised positions')
  await expect(fab).toHaveAttribute('aria-pressed', 'true')
  await expect(fab).toHaveClass(/\bon\b/)
  // Two on states, two segments (#620): the first is half the ring.
  expect(await fab.evaluate((el) => el.querySelectorAll('.fab-ring circle').length)).toBe(2)
  expect(await lit()).toBe(1)
  await expect(page).toHaveURL(/[?&]nodepos=positions/)

  await fab.click()
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: positions and reach')
  expect(await lit()).toBe(2)
  await expect(page).toHaveURL(/[?&]nodepos=reach/)

  await fab.click()
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: off')
  await expect(fab).toHaveAttribute('aria-pressed', 'false')
  await expect(fab).not.toHaveClass(/\bon\b/)
  expect(await lit()).toBe(0)
  await expect(page).not.toHaveURL(/[?&]nodepos=/)
})

// A role change repaints the button (applyObserverGate): a member signed out
// elsewhere is not left looking at a stop the layer cannot draw, and a guest
// who becomes a member gets the cycle on the next tap.
test('the node-positions button follows a role change both ways', async ({ page }) => {
  const ref = { role: 'member' }
  await stub(page, ref)
  await page.goto('/?nodepos=reach')
  const fab = page.locator('#nodepos-toggle')
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: positions and reach')

  ref.role = 'guest'
  await recheckRole(page)
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: off', { timeout: 10000 })
  await expect(fab).toHaveAttribute('aria-pressed', 'false')
  await fab.click()
  await expect(page.locator('#nodepos-key')).toContainText(/account/i)
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: off')

  ref.role = 'member'
  await recheckRole(page)
  await expect(page.locator('#nodepos-key')).toBeHidden({ timeout: 10000 })
  await fab.click()
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: advertised positions')
})
