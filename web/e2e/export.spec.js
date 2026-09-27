import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures.js'
import { tilePixel } from '../exportterrain.js'

// The Export sheet (#666): "Repeaters heard" draws the reach layer's stars
// into a 1200×1200 PNG and downloads it. The basemap is the fixtures' bare
// style here, so this checks the path end to end, not the picture.

const node = { pubkey: 'db11db11f7808b97' + 'a'.repeat(48), name: 'NL-NIJ-Dikkeboom', lat: 51.84, lon: 5.86 }
const heard = (lat, lon, rssi, min) => ({ lat, lon, rssi, snr: 4, sender_id: 'db11db11f7808b97', sender_kind: 'discover_pubkey',
  sender_role: 'Repeater', hops: 0, packet_type: 'Response', hunter_name: 'kas', rx_at: `2026-09-07T12:${String(min).padStart(2, '0')}:00Z` })
const points = [heard(51.845, 5.865, -80, 1), heard(51.85, 5.87, -95, 2), heard(51.835, 5.85, -105, 3), heard(51.83, 5.87, -112, 4)]

async function stub(page, role) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role, username: 'k' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [node] } }))
}

test('Repeaters heard downloads a 1200×1200 PNG of the view', async ({ page }) => {
  await stub(page, 'member')
  await page.goto('/?mode=points&lat=51.84&lon=5.86&z=12&from=2026-09-07T00:00&to=2026-09-08T00:00')
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await expect(page.locator('#ex-heard')).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ex-heard')])
  expect(download.suggestedFilename()).toMatch(/^mesh-hunter-repeaters-heard-\d{4}-\d{2}-\d{2}\.png$/)
  const png = readFileSync(await download.path())
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 1200])
  await expect(page.locator('#ex-heard-status')).toHaveText(`Saved as ${download.suggestedFilename()}`)
})

test('a guest is told what the export needs, and cannot start it', async ({ page }) => {
  await stub(page, 'guest')
  await page.goto('/')
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await expect(page.locator('#ex-heard')).toBeDisabled()
  await expect(page.locator('#ex-heard-status')).toHaveText('Exports need an account. Log in to use them.')
})

test('Escape closes the sheet and hands focus back to the button', async ({ page }) => {
  await stub(page, 'member')
  await page.goto('/')
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('#export-modal')).toBeHidden()
  await expect(page.locator('#export-btn')).toBeFocused()
})

// Below 900px Export is in the menu, before Start mapping and Log in join it
// below 768px (barnarrow.js): between 768 and 900px its label wrapped the bar
// into another row.
test('Export sits in the menu below 900px and opens the sheet from there', async ({ page }) => {
  await stub(page, 'member')
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')
  await expect(async () => {
    if (await page.locator('#settings-modal').isHidden()) await page.click('#settings-btn')
    await expect(page.locator('#settings-modal #export-btn')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await expect(page.locator('#bar #export-btn')).toHaveCount(0)
  await page.click('#settings-modal #export-btn')
  await expect(page.locator('#export-modal')).toBeVisible()
  await expect(page.locator('#settings-modal')).toBeHidden()
  await page.keyboard.press('Escape')
  // The button it came from is in the closed menu, so the focus goes to the
  // menu's button rather than being dropped.
  await expect(page.locator('#settings-btn')).toBeFocused()
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.locator('#bar #export-btn')).toBeVisible()
})

// #720: Reach of one repeater works on the selected star. The target picked
// in the URL selects it; without a selection the row says what to do.
const REACH_URL = `/?mode=points&lat=51.84&lon=5.86&z=12&from=2026-09-07T00:00&to=2026-09-08T00:00&senders=${encodeURIComponent(JSON.stringify(['db11db11f7808b97']))}`

test('Reach of one repeater downloads a PNG named after the selected repeater', async ({ page }) => {
  await stub(page, 'member')
  await page.goto(REACH_URL)
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await expect(page.locator('#ex-reach')).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ex-reach')])
  expect(download.suggestedFilename()).toMatch(/^mesh-hunter-reach-nl-nij-dikkeboom-\d{4}-\d{2}-\d{2}\.png$/)
  const png = readFileSync(await download.path())
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 1200])
})

test('Reach of one repeater asks for a repeater when none is selected', async ({ page }) => {
  await stub(page, 'member')
  await page.goto('/?mode=points&lat=51.84&lon=5.86&z=12')
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  await expect(page.locator('#ex-reach')).toBeDisabled()
  await expect(page.locator('#ex-reach-status')).toHaveText('Select one repeater on the map: tap its ▲, or pick it as target.')
  await expect(page.locator('#ex-heard')).toBeEnabled()
})

// A Terrarium tile with the ground at `metres` everywhere but one pixel,
// `hole`, at 0 m. Drawn in the page, which has the PNG encoder.
async function terrariumTile(page, metres, hole = null) {
  const v = metres + 32768
  const bytes = await page.evaluate(async ({ r, g, hole }) => {
    const c = new OffscreenCanvas(256, 256)
    const ctx = c.getContext('2d')
    ctx.fillStyle = `rgb(${r},${g},0)`
    ctx.fillRect(0, 0, 256, 256)
    if (hole) { ctx.fillStyle = 'rgb(128,0,0)'; ctx.fillRect(hole.px, hole.py, 1, 1) }
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  }, { r: Math.floor(v / 256), g: v % 256, hole })
  return Buffer.from(bytes)
}

test('Reach of one repeater fills along the lines, and leaves out what the terrain hides', async ({ page }) => {
  await stub(page, 'member')
  await page.goto(REACH_URL)
  await expect(async () => {
    if (await page.locator('#export-modal').isHidden()) await page.click('#export-btn')
    await expect(page.locator('#export-modal')).toBeVisible()
  }).toPass({ timeout: 15000 })
  const reach = async () => {
    await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ex-reach')])
    return page.evaluate(() => window.__lastReach())
  }
  // The fixtures block the DEM host: the lines alone decide.
  const open = await reach()
  expect(open.filled).toBeGreaterThan(0)
  // The repeater in a pit, 500 m of ground all round it: the lines are there,
  // the repeater sees none of them.
  const at = tilePixel(51.84, 5.86, 10)
  const wall = await terrariumTile(page, 500)
  const pit = await terrariumTile(page, 500, at)
  await page.route('**/elevation-tiles-prod/**', (r) => r.fulfill({ status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' }, body: r.request().url().endsWith(`/10/${at.x}/${at.y}.png`) ? pit : wall }))
  const hidden = await reach()
  expect(hidden.heard).toBe(open.heard)
  expect(hidden.filled).toBeLessThan(open.filled)
})
