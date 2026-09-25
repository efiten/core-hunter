import { test, expect, mapSettled, setNodePos, openSettings, glyphs, expectGlyphs, tapGlyph } from './fixtures.js'

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
// #661: a flood's 1-byte last hop, 'aa', heard around R1. Reach at -85 dBm is
// the full 15 km, and R1 is the one registry node whose key starts with it.
const lastHops = ring(51.003, 4.003, 4, (lat, lon) => at(lat, lon, -85, 'aa', 'path_hash', null))
const withLastHops = (page) => page.route('**/api/points*', (r) => r.fulfill({ json: { points: [...hearings, ...lastHops] } }))

test('the reach stop draws one ray per repeater hearing, from ▲ or ●, and leaves the companion out', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13')
  await setNodePos(page, 'reach')
  await expect(page).toHaveURL(/[?&]nodepos=reach/)
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  // R1's hub is the node layer's ▲, in the star's hue; R2 has no registry
  // position, so its star hangs from a ● at the estimate.
  await expectGlyphs(page, 'hub', 1)
  await expectGlyphs(page, 'advert', 1)
  const p = await props(page)
  const r1 = p.filter((f) => f.id === R1), r2 = p.filter((f) => f.id === R2)
  expect(r1).toHaveLength(6); expect(r2).toHaveLength(5)
  expect(r1[0].color).not.toBe(r2[0].color)
  expect(new Set(r1.map((f) => f.color)).size).toBe(1)
  expect((await glyphs(page, 'advert'))[0].color).toBe(r1[0].color)
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
  // R2's hub is keyed by its id, in its star's hue.
  const hub = (await glyphs(page, 'hub'))[0]
  expect(hub.key).toBe(R2)
  expect(hub.color).toBe(r2[0].color)
})

test('a 1-byte last hop joins the star of the one node it can be, and takes its hue (#661)', async ({ page }) => {
  await withLastHops(page)
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(15)
  const p = await props(page)
  const r1 = p.filter((f) => f.id === R1)
  expect(r1).toHaveLength(10)
  // No star of its own: R2's is still the only ●.
  await expectGlyphs(page, 'hub', 1)
  const dots = await page.evaluate(() => window.__features('points'))
  expect(dots.filter((d) => d.color === r1[0].color)).toHaveLength(10)
})

test('a 1-byte last hop with two nodes in reach draws no ray (#661)', async ({ page }) => {
  await withLastHops(page)
  // A second node whose key starts with 'aa', 4 km from the hearings.
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [
    { pubkey: R1, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0005 },
    { pubkey: 'aa11' + '00'.repeat(30), name: 'Elders-aa', lat: 51.04, lon: 4.003 },
  ] } }))
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expectGlyphs(page, 'advert', 1, { timeout: 10000 })
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  expect((await props(page)).filter((f) => f.id === R1)).toHaveLength(6)
  await expectGlyphs(page, 'hub', 1)
})

test('a picked 1-byte last hop selects the star of the node it was placed on, ▲ included (#661)', async ({ page }) => {
  await withLastHops(page)
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach&senders=' + encodeURIComponent(JSON.stringify(['aa'])))
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(15)
  const p = await props(page)
  expect(p.filter((f) => f.id === R1).every((f) => !f.dim)).toBe(true)
  expect(p.filter((f) => f.id === R2).every((f) => f.dim)).toBe(true)
  await expect.poll(async () => (await glyphs(page, 'advert')).filter((a) => a.sel).length).toBe(1)
  expect((await glyphs(page, 'advert')).filter((a) => a.op < 1)).toHaveLength(0)
  await expect.poll(async () => (await glyphs(page, 'hub')).filter((h) => h.op < 1).length).toBe(1)
})

// #661 with #624: a selection keeps lit what belongs to the selected star, and
// a 1-byte last hop placed on R1 belongs to R1's star, not to a star of 'aa'.
// So a pick of R1, by its ▲ or by the id 'aa', leaves those dots as they were
// and dims R2's.
test('a selection keeps the dots of the last hops placed on its node lit, picked by ▲ or by id (#661)', async ({ page }) => {
  await withLastHops(page)
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(15)
  // `i` indexes the served points: 6-10 are R2, 14-17 the last hops 'aa'.
  const opOf = async () => {
    const dots = await page.evaluate(() => window.__features('points'))
    const by = (lo, hi) => dots.filter((d) => d.i >= lo && d.i <= hi).map((d) => d.op)
    return { r2: by(6, 10), hops: by(14, 17) }
  }
  const before = await opOf()
  expect(before.hops).toHaveLength(4)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect.poll(async () => (await opOf()).r2.every((op, k) => Math.abs(op - before.r2[k] * 0.25) < 1e-9)).toBe(true)
  expect((await opOf()).hops).toEqual(before.hops)
  // Picked the other way round, as the id 'aa' in the list: the hops belong to
  // R1's star, which the pick selects (starSelected), so they stay lit too.
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach&senders=' + encodeURIComponent(JSON.stringify(['aa'])))
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(15)
  await expect.poll(async () => (await opOf()).r2.every((op, k) => Math.abs(op - before.r2[k] * 0.25) < 1e-9)).toBe(true)
  expect((await opOf()).hops).toEqual(before.hops)
})

test('a tap on ▲ selects that star and dims the others; a second tap or a tap on the map clears it', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect.poll(async () => (await glyphs(page, 'advert')).filter((a) => a.sel).length).toBe(1)
  await expect.poll(async () => (await props(page)).filter((f) => f.dim).length).toBe(5)
  const p = await props(page)
  const r1 = p.find((f) => f.id === R1), r2 = p.find((f) => f.id === R2)
  expect(r1.dim).toBe(false); expect(r2.dim).toBe(true)
  expect(r2.op).toBeLessThan(0.2)
  await expect.poll(async () => (await glyphs(page, 'hub')).filter((h) => h.op < 1).length).toBe(1)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
  await expect.poll(async () => (await glyphs(page, 'advert')).filter((a) => a.sel).length).toBe(0)
  // Select again, then a tap on bare map clears.
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await mapSettled(page)
  // A bare spot, south-east of the centre: the view snapped to the hearings,
  // which lie centre, north-east and south-west of it, and no ray runs that
  // way. It used to be the map's top-left corner, where the ticker starts
  // since #630; the map's left edge at half height is the ▲ itself, whose
  // second tap would clear the selection without testing the bare map.
  const pt = await page.evaluate(() => window.__mapProject(50.99, 4.01))
  const box = await page.locator('#map').boundingBox()
  const bare = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).tagName, [box.x + pt.x, box.y + pt.y])
  expect(bare, 'the spot is not bare map').toBe('CANVAS')
  await page.mouse.click(box.x + pt.x, box.y + pt.y)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
})

test('a picked target is the selection too, and the other stars stay up dimmed', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach&senders=' + encodeURIComponent(JSON.stringify([R1])))
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  const p = await props(page)
  expect(p.find((f) => f.id === R1).dim).toBe(false)
  expect(p.find((f) => f.id === R2).dim).toBe(true)
})

// #624: a selection steps back more than the other stars' rays. Every dot that
// is not the selected repeater's dims by the rays' own factor, the companion's
// too, since a companion belongs to no repeater and is never part of a selection.
test('a selection dims every dot that is not the selected repeater\'s, the companion\'s included', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  // `i` indexes the served hearings: 0-5 are R1 at -70 dBm (hot, 0.7), 6-10 R2
  // at -95 (mid, 0.46), 11-13 the companion C1 at -80 (hot, 0.7).
  const opOf = async () => {
    const dots = await page.evaluate(() => window.__features('points'))
    const by = (lo, hi) => dots.filter((d) => d.i >= lo && d.i <= hi).map((d) => d.op)
    return { r1: by(0, 5), r2: by(6, 10), c1: by(11, 13) }
  }
  const near = (ops, want) => ops.length > 0 && ops.every((op) => Math.abs(op - want) < 1e-9)
  const before = await opOf()
  expect(near(before.r1, 0.7)).toBe(true)
  expect(near(before.r2, 0.46)).toBe(true)
  expect(near(before.c1, 0.7)).toBe(true)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect.poll(async () => near((await opOf()).r2, 0.46 * 0.25)).toBe(true)
  const after = await opOf()
  expect(near(after.r1, 0.7)).toBe(true)
  expect(near(after.c1, 0.7 * 0.25)).toBe(true)
})

// #623: a repeater the registry places but that has no hearings in the window
// has no star, and its ▲ used to open a popup and do nothing else. It is
// selectable now: nothing draws from it, everything else dims, and the popup
// says why there is no reach.
test('a repeater with no hearings is selectable, and its popup says there is nothing to draw', async ({ page }) => {
  const R3 = 'dd'.repeat(32)
  // Only R3 in the registry, so the one ▲ is R3's. R1 keeps its hearings, so
  // the reach is still on and R1's star hangs from its estimate instead.
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ json: { nodes: [{ pubkey: R3, name: 'Repeater-Noord', lat: 51.001, lon: 4.001 }] } }))
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  await expectGlyphs(page, 'advert', 1)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R3])
  // No dot belongs to R3, so every one of them steps back.
  await expect.poll(async () => (await page.evaluate(() => window.__features('points'))).every((d) => d.op < 0.2)).toBe(true)
  await expect(page.locator('.pp-reach')).toHaveText('Hide reach')
  await expect(page.locator('.maplibregl-popup-content')).toContainText('No hearings in this window yet')
})

// #623: the popup offers the action, so selecting a star is no longer an
// undiscoverable tap, and a press keeps the popup up with the new state. The
// last press starts from nothing selected on purpose: the button's handler is
// delegated on the document, so the click also reaches the map, whose tap on
// bare map clears the selection.
test('the popup\'s reach button selects and clears, and the popup stays up with the new state', async ({ page }) => {
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  // The ticker's first place is the top left (#630). At 1280x720 its 680x298
  // box covers the popup this marker opens, so it is closed first: the popup's
  // own behaviour is what this test pins.
  await page.locator('#rx-log .rx-close').click()
  await expect(page.locator('#rx-log')).toBeHidden()
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect(page.locator('.pp-reach')).toHaveText('Hide reach')
  // R1 has hearings, so the popup makes no excuse for it.
  await expect(page.locator('.maplibregl-popup-content')).not.toContainText('No hearings')
  await page.locator('.pp-reach').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
  await expect(page.locator('.pp-reach')).toHaveText('Show reach')
  await page.locator('.pp-reach').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect(page.locator('.pp-reach')).toHaveText('Hide reach')
})

// #623 with #661: a press adds or removes the repeater's own key, and nothing
// else. A pick of the id 'aa' in the list selects R1's star through the last
// hops placed on it, so the ▲ stays selected, but the popup offers "Show
// reach": "Hide reach" would promise a press that cannot undo the list's pick.
test('a relay id pick keeps the ▲ selected, and its popup offers the node\'s own pick (#661)', async ({ page }) => {
  await withLastHops(page)
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach&senders=' + encodeURIComponent(JSON.stringify(['aa'])))
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(15)
  await page.locator('#rx-log .rx-close').click()
  await expect(page.locator('#rx-log')).toBeHidden()
  await expect.poll(async () => (await glyphs(page, 'advert')).filter((a) => a.sel).length).toBe(1)
  await tapGlyph(page)
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([R1])
  await expect(page.locator('.pp-reach')).toHaveText('Hide reach')
  await page.locator('.pp-reach').click()
  await expect.poll(() => page.evaluate(() => window.__coverageSel())).toEqual([])
  await expect.poll(async () => (await glyphs(page, 'advert')).filter((a) => a.sel).length).toBe(1)
  await expect(page.locator('.pp-reach')).toHaveText('Show reach')
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
  await setNodePos(page, 'positions')
  await expect.poll(() => rays(page)).toBe(0)
  await expectGlyphs(page, 'advert', 1)
  await expectGlyphs(page, 'hub', 0)
  await expect(page).toHaveURL(/[?&]nodepos=positions/)
  await setNodePos(page, 'off')
  await expectGlyphs(page, 'advert', 0)
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

// #604: the registry out does not take the reach with it. Every star hangs
// from its estimate, no ▲ is drawn, and the line says the registry is out,
// for 3 s (#591). Once it answers again the ▲ come back.
test('with the registry out the stars still draw, every one from its estimate (#604)', async ({ page }) => {
  let registryUp = false, asked = 0
  await page.route('**/api/nodes/positions*', (r) => {
    asked++
    return registryUp
      ? r.fulfill({ json: { nodes: [{ pubkey: R1, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0005 }] } })
      : r.fulfill({ status: 503, json: { error: 'registry_unavailable' } })
  })
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
  // R1 has no registry position now, so its star hangs from a ● like R2's.
  await expectGlyphs(page, 'hub', 2)
  await expectGlyphs(page, 'advert', 0)
  const key = page.locator('#nodepos-key')
  await expect(key).toHaveText(/Node registry unreachable/)
  await expect(key).toBeHidden({ timeout: 5000 })
  // A redraw during the same outage does not bring the line back. Read once,
  // right after that redraw asked the registry: an assertion that retries
  // would wait out the next 3 s timer and pass either way.
  const before = asked
  await page.evaluate(() => window.__refresh())
  await expect.poll(() => asked).toBeGreaterThan(before)
  await page.waitForTimeout(500)
  expect(await key.isHidden(), 'the outage line came back on a redraw').toBe(true)
  // The registry answers again: the ▲ is back and R1's star hangs from it.
  registryUp = true
  await page.evaluate(() => window.__refresh())
  await expectGlyphs(page, 'advert', 1)
  await expectGlyphs(page, 'hub', 1)
})

// #591: a 5xx that is not our server's JSON is the map server not answering,
// a different thing to wait for than the registry being out.
test('a bare 5xx says the map server is unreachable, not the registry (#591)', async ({ page }) => {
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html>Gateway Timeout</html>' }))
  await page.goto('/?mode=points&lat=51&lon=4&z=13&nodepos=reach')
  await expect(page.locator('#nodepos-key')).toHaveText(/Map server unreachable/, { timeout: 10000 })
  await expect.poll(() => rays(page), { timeout: 10000 }).toBe(11)
})
