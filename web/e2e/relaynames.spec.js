import { test, expect } from './fixtures.js'

// #663: the ticker and the point popup name a relay the way the app does. A
// name on a 1 to 3-byte id is a guess and wears ~ (#452), and the registry
// node within reach decides the name first (#661).

const RELAY = {
  lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'a1b2', sender_kind: 'relay', sender_label: 'repeater-3',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', channel_name: '', packet_type: 'TextMessage', hops: 2,
  rx_at: new Date(Date.now() - 5000).toISOString(),
}
const NOORD = { pubkey: 'a1b2' + '0'.repeat(60), name: 'Mast Noord', lat: 51.001, lon: 4.001 }
const ZUID = { pubkey: 'a1b2' + 'f'.repeat(60), name: 'Mast Zuid', lat: 50.999, lon: 3.999 }

async function setup(page, { role, points, nodes = [] }) {
  await page.route('**/api/auth/me', (r) => (role === 'guest'
    ? r.fulfill({ status: 401, json: { error: 'unauthorised' } })
    : r.fulfill({ json: { role, username: 'm' } })))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points } }))
  const asked = []
  await page.route('**/api/nodes/positions*', (r) => {
    asked.push(new URL(r.request().url()).searchParams.get('bbox'))
    return role === 'guest' ? r.fulfill({ status: 403, json: { error: 'forbidden' } }) : r.fulfill({ json: { nodes } })
  })
  return asked
}

async function openPointPopup(page) {
  await expect(async () => {
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.maplibregl-popup')).toBeVisible({ timeout: 1000 })
  }).toPass()
}

test('a guest reads a relay name with the guess mark, and the registry is not asked', async ({ page }) => {
  const asked = await setup(page, { role: 'guest', points: [RELAY] })
  await page.goto('/?mode=points')
  const line = page.locator('#rx-log .rx-ln')
  await expect(line).toHaveCount(1, { timeout: 10000 })
  await expect(line.locator('.rx-sn')).toContainText('~repeater-3')
  await expect(line.locator('.rx-id')).toHaveText('a1b2')
  expect(asked).toEqual([])
})

test('a member reads the name of the one registry node in reach, with the node layer off', async ({ page }) => {
  await setup(page, { role: 'member', points: [RELAY], nodes: [NOORD] })
  await page.goto('/?mode=points')
  await expect(page.locator('#nodepos-toggle')).toHaveAttribute('aria-pressed', 'false')
  const line = page.locator('#rx-log .rx-ln')
  await expect(line).toHaveCount(1, { timeout: 10000 })
  await expect(line.locator('.rx-sn')).toContainText('~Mast Noord')
  await expect(line.locator('.rx-sn')).not.toContainText('repeater-3')
  await openPointPopup(page)
  await expect(page.locator('.maplibregl-popup-content')).toContainText('sender ~Mast Noord')
})

test('two registry nodes in reach leave the id and no name', async ({ page }) => {
  await setup(page, { role: 'member', points: [RELAY], nodes: [NOORD, ZUID] })
  await page.goto('/?mode=points')
  const line = page.locator('#rx-log .rx-ln')
  await expect(line).toHaveCount(1, { timeout: 10000 })
  await expect(line.locator('.rx-sn')).toContainText('a1b2')
  await expect(line.locator('.rx-sn')).not.toContainText('repeater-3')
  await expect(line.locator('.rx-sn')).not.toContainText('Mast')
})

test('a 1-byte id placed on a node reads by that name, with its # id beside it', async ({ page }) => {
  const hash = { ...RELAY, sender_id: 'a1', sender_kind: 'path_hash', sender_label: 'a1' }
  await setup(page, { role: 'member', points: [hash], nodes: [NOORD] })
  await page.goto('/?mode=points')
  const line = page.locator('#rx-log .rx-ln')
  await expect(line).toHaveCount(1, { timeout: 10000 })
  await expect(line.locator('.rx-sn')).toContainText('~Mast Noord')
  await expect(line.locator('.rx-id')).toHaveText('#a1')
  // The popup's id line reads the id as the ticker does.
  await openPointPopup(page)
  await expect(page.locator('.maplibregl-popup-content .pp-id')).toHaveText('#a1')
})

test('the registry is asked around the ticker lines, not around the view', async ({ page }) => {
  // The ticker's page holds a line heard 2 degrees north of the one point the
  // map frames, so the view cannot hold both and the slice has to.
  const far = { ...RELAY, lat: 53, lon: 4, rx_at: new Date(Date.now() - 1000).toISOString() }
  const asked = await setup(page, { role: 'member', points: [RELAY], nodes: [] })
  await page.route('**/api/points*', (r) => {
    const q = new URL(r.request().url()).searchParams
    const ticker = q.get('limit') === '200' && q.get('offset') === '0' && !q.get('bbox')
    return r.fulfill({ json: { points: ticker ? [RELAY, far] : [RELAY] } })
  })
  await page.goto('/?mode=points')
  await expect(page.locator('#rx-log .rx-ln')).toHaveCount(2, { timeout: 10000 })
  const view = await page.evaluate(() => window.__mapBounds())
  expect(view.north, 'the view holds the far line, so this measures nothing').toBeLessThan(53)
  await expect.poll(() => asked.some((bbox) => {
    const [south, , north] = String(bbox).split(',').map(Number)
    return south < 51 && north > 53
  })).toBe(true)
})

// The lines drawn before the registry answered are named again in place when
// it does (receptionticker.js rebuild): same rows, so no rebuild, and the
// reader keeps where they scrolled to. A deterministic path: the first slice
// holds no node, and a minute later the registry names one.
test('a line drawn before the registry named its relay is renamed in place, where the reader scrolled', async ({ page }) => {
  await page.clock.install()
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...RELAY, rx_at: new Date(Date.now() - 5000 - i * 1000).toISOString() }))
  let nodes = []
  await setup(page, { role: 'member', points: rows })
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes } }))
  await page.goto('/?mode=points')
  const lines = page.locator('#rx-log .rx-ln')
  await expect(lines).toHaveCount(40, { timeout: 10000 })
  await expect(lines.first().locator('.rx-sn')).toContainText('~repeater-3')
  const list = page.locator('#rx-log .rx-list')
  await list.evaluate((el) => { el.scrollTop = Math.floor(el.scrollHeight / 3) })
  const scrolled = await list.evaluate((el) => el.scrollTop)
  expect(scrolled, 'the list has to scroll for this to measure anything').toBeGreaterThan(0)
  nodes = [NOORD]
  // Past the slice's minute, and past the next poll.
  await page.clock.fastForward(66_000)
  await expect(lines.first().locator('.rx-sn')).toContainText('~Mast Noord')
  await expect(lines.last().locator('.rx-sn')).toContainText('~Mast Noord')
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolled)
})

// A tap that lands before the registry answered opens the popup by the label;
// when the answer lands, the open popup names the node it places the relay on.
test('a popup opened before the registry answered is named again when it does', async ({ page }) => {
  await setup(page, { role: 'member', points: [RELAY] })
  let release
  const answered = new Promise((r) => { release = r })
  await page.route('**/api/nodes/positions*', async (r) => { await answered; return r.fulfill({ json: { nodes: [NOORD] } }) })
  await page.goto('/?mode=points')
  await expect(page.locator('#rx-log .rx-ln')).toHaveCount(1, { timeout: 10000 })
  await openPointPopup(page)
  await expect(page.locator('.maplibregl-popup-content')).toContainText('sender ~repeater-3')
  release()
  await expect(page.locator('.maplibregl-popup-content')).toContainText('sender ~Mast Noord')
})
