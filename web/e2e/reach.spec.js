import { test, expect, mapSettled, setNodePos, openSettings } from './fixtures.js'

// #603: the third stop of Node positions draws every repeater's reach at
// once: one ray per hearing attributed to it, from the ▲ (or the ● estimate
// when the registry has no position), in a hue fixed per id, the strength in
// the ray, a two-way hearing at full opacity and a one-way one receded. A
// selection keeps one star and dims the rest; in 3D the rays leave the mast.
const R1 = 'aa'.repeat(32)   // a repeater the registry places
const R2 = 'b7'               // a relay hash: no registry position, estimate only
const C1 = 'cc'.repeat(32)    // a companion: no star
const at = (lat, lon, rssi, sender_id, sender_kind, sender_role) => ({
  lat, lon, rssi, snr: 5, sender_id, sender_kind, sender_role, sender_label: '', hunter_name: 'Hunter 1', packet_type: 'Advert', rx_at: '2026-09-06T10:00:00Z',
})
const ring = (lat, lon, n, f) => Array.from({ length: n }, (_, i) => f(lat + Math.sin(i) * 0.004, lon + Math.cos(i) * 0.006, i))
const hearings = [
  ...ring(51, 4, 6, (lat, lon, i) => at(lat, lon, -70, R1, i < 2 ? 'discover_pubkey' : 'advert_pubkey', 'Repeater')),
  ...ring(51.02, 4.02, 5, (lat, lon) => at(lat, lon, -95, R2, 'relay', null)),
  ...ring(50.98, 3.98, 3, (lat, lon) => at(lat, lon, -80, C1, 'advert_pubkey', 'Companion')),
]

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: hearings } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [{ pubkey: R1, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0005 }] } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({ json: { pubkey: R1, name: 'Repeater-Zuid', ambiguous: false, lat: 51.0005, lon: 4.0005 } }))
})
const rays = (page) => page.evaluate(() => window.__featureCount && window.__featureCount('reach'))
const props = (page) => page.evaluate(() => window.__features('reach'))

test('the reach stop draws one ray per repeater hearing, from ▲ or ●, and leaves the companion out', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13')
  await setNodePos(page, 'reach')
  await expect(page).toHaveURL(/[?&]nodepos=reach/)
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  // R1's hub is the node layer's ▲, in the star's hue; R2 has no registry
  // position, so its star hangs from a ● at the estimate.
  await expect(page.locator('.rc-hub.rc-estimate')).toHaveCount(1)
  await expect(page.locator('.np-advert')).toHaveCount(1)
  const p = await props(page)
  const r1 = p.filter((f) => f.id === R1), r2 = p.filter((f) => f.id === R2)
  expect(r1).toHaveLength(6); expect(r2).toHaveLength(5)
  expect(r1[0].color).not.toBe(r2[0].color)
  expect(new Set(r1.map((f) => f.color)).size).toBe(1)
  const advColor = await page.locator('.np-advert').evaluate((el) => el.style.color)
  const hue = await page.evaluate((c) => { const s = document.createElement('span'); s.style.color = c; document.body.appendChild(s); const v = getComputedStyle(s).color; s.remove(); return v }, r1[0].color)
  expect(advColor).toBe(hue)
  // Two-way (the Discover replies) at full opacity, one-way receded, same width.
  const two = r1.filter((f) => f.two), one = r1.filter((f) => !f.two)
  expect(two).toHaveLength(2)
  expect(two[0].op).toBeGreaterThan(one[0].op)
  expect(two[0].w).toBe(one[0].w)
  // The stronger star's rays are wider than the weaker one's.
  expect(r1[0].w).toBeGreaterThan(r2[0].w)
  // The dots take the repeater's hue while the reach is on; the companion's keep the tier.
  const dots = await page.evaluate(() => window.__features('points'))
  expect(dots.filter((d) => d.color === r1[0].color)).toHaveLength(6)
  expect(dots.filter((d) => d.color === r2[0].color)).toHaveLength(5)
})

test('a tap on ▲ selects that star and dims the others; a second tap or a tap on the map clears it', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  await page.locator('.np-advert').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect(page.locator('.np-advert.np-selected')).toHaveCount(1)
  await expect.poll(async () => (await props(page)).filter((f) => f.dim).length).toBe(5)
  const p = await props(page)
  const r1 = p.find((f) => f.id === R1), r2 = p.find((f) => f.id === R2)
  expect(r1.dim).toBe(false); expect(r2.dim).toBe(true)
  expect(r2.op).toBeLessThan(0.2)
  await expect(page.locator('.rc-hub.np-dim')).toHaveCount(1)
  await page.locator('.np-advert').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
  await expect(page.locator('.np-advert.np-selected')).toHaveCount(0)
  // Select again, then a tap on bare map clears.
  await page.locator('.np-advert').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await mapSettled(page)
  // A bare spot: the map's top-left corner, under the bar. The view snapped
  // to the hearings, which lie centre, north-east and south-west of it, and
  // the ▲'s popup opens at the centre.
  const box = await page.locator('#map').boundingBox()
  await page.mouse.click(box.x + 60, box.y + 140)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
})

test('a picked target is the selection too, and the other stars stay up dimmed', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach&senders=' + encodeURIComponent(JSON.stringify([R1])))
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  const p = await props(page)
  expect(p.find((f) => f.id === R1).dim).toBe(false)
  expect(p.find((f) => f.id === R2).dim).toBe(true)
})

test('in 3D the rays leave the ground: the line layer goes, the ray layer takes the same rays', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  expect(await page.evaluate(() => window.__layerVisible('reach'))).toBe(true)
  expect(await page.evaluate(() => window.__raysVisible())).toBe(false)
  await page.click('#view-toggle')
  await expect.poll(() => page.evaluate(() => window.__layerVisible('reach'))).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__raysVisible())).toBe(true)
  expect(await page.evaluate(() => window.__rayCount())).toBe(11)
  await page.click('#view-toggle')
  await expect.poll(() => page.evaluate(() => window.__layerVisible('reach'))).toBe(true)
  expect(await page.evaluate(() => window.__raysVisible())).toBe(false)
})

test('the positions stop keeps the ▲ and drops the rays; off drops both', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  await setNodePos(page, '1')
  await expect.poll(() => rays(page)).toBe(0)
  await expect(page.locator('.np-advert')).toHaveCount(1)
  await expect(page.locator('.rc-hub')).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]nodepos=1/)
  await setNodePos(page, '')
  await expect(page.locator('.np-advert')).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]nodepos=/)
})

// A WebGL1 context without 32-bit indices (#593 review): the ray layer stays
// off the map rather than failing every drawElements, the flat rays still
// draw, and the console says why once, not again on the next style load. The
// canvas here refuses WebGL2 and hides the extension, and counts the WebGL2
// asks: MapLibre's own, then one per mount of the overlays.
test('without 32-bit indices the rays stay off the 3D map, and the console says so once', async ({ page }) => {
  await page.addInitScript(() => {
    window.__uintWarnings = 0
    window.__webgl2Asks = 0
    const warn = console.warn.bind(console)
    console.warn = (...args) => { if (String(args[0]).includes('OES_element_index_uint')) window.__uintWarnings++; warn(...args) }
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === 'webgl2') { window.__webgl2Asks++; return null }
      const ctx = getContext.call(this, type, attrs)
      if (ctx && type === 'webgl' && !ctx.__noUint) {
        const getExtension = ctx.getExtension.bind(ctx)
        ctx.getExtension = (name) => (name === 'OES_element_index_uint' ? null : getExtension(name))
        ctx.__noUint = true
      }
      return ctx
    }
  })
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  expect(await page.evaluate(() => window.__layerVisible('reach'))).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__uintWarnings)).toBe(1)
  await page.click('#view-toggle')
  await expect.poll(() => page.evaluate(() => window.__raysVisible())).toBe(true)
  expect(await page.evaluate(() => window.__layerVisible('reach-3d'))).toBe(false)
  expect(await page.evaluate(() => window.__rayCount())).toBe(0)
  // A theme switch loads a style, and the overlays mount again.
  const asked = await page.evaluate(() => window.__webgl2Asks)
  await openSettings(page, 'settings')
  await page.click('#theme-toggle')
  await page.click('#ss-close')
  await expect(page.locator('#settings-modal')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__webgl2Asks), { timeout: 10000 }).toBeGreaterThan(asked)
  expect(await page.evaluate(() => window.__uintWarnings)).toBe(1)
  expect(await page.evaluate(() => window.__layerVisible('reach-3d'))).toBe(false)
})
