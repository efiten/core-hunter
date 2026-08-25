import { test, expect, clickUntil, mapSettled, setFilter } from './fixtures.js'
import { NODEPOS_GLANCE_MS } from '../nodeposnotice.js'

// Node-position layer (#197): a sender's self-advertised position (▲) drawn
// against our RSSI estimate (●), with the gap between them as drift.
const SENDER = 'aa'.repeat(32)

// A ring of receptions around (51.000, 4.000) — enough spread to clear the
// 3-inlier floor and produce a well-encircled estimate at the centre.
const ring = (lat, lon, rM, n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * 2 * Math.PI
  return {
    lat: lat + (rM * Math.sin(a)) / 111320,
    lon: lon + (rM * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)),
    rssi: -65 - i, snr: -3, sender_id: SENDER, sender_kind: 'advert_pubkey', sender_label: '', hunter_name: 'ON8AR',
    packet_type: 'Advert', rx_at: '2026-07-19T10:00:00Z',
  }
})

// The advertised position sits north of the estimate centre. Since #377 it
// comes from the server's bulk registry proxy rather than from a per-id
// /api/resolve lookup: the layer is now registry-first, so what it draws no
// longer depends on the filtered reception set. /api/resolve stays stubbed
// because the rest of the page still resolves names through it.
function routes(page, { lat, lon, points, nodes }) {
  return Promise.all([
    page.route('**/api/points*', (r) => r.fulfill({ json: { points } })),
    page.route('**/api/nodes/positions*', (r) => r.fulfill({
      json: { nodes: nodes ?? [{ pubkey: SENDER, name: 'Repeater-Zuid', lat, lon }] },
    })),
    page.route('**/api/resolve*', (r) => r.fulfill({
      json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false, lat, lon },
    })),
  ])
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

test('layer is off by default and the toggle is visible to a member', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await expect(page.locator('.np-layer-toggle')).toBeVisible()
  await expect(page.locator('#f-nodepos')).not.toBeChecked()
  await expect(page.locator('#nodepos-note')).toBeHidden()
})

test('checking it draws the advertised marker, reflects in the URL, and shows the disclaimer', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)

  // Exactly one marker per node — concurrent redraws must not leave duplicates.
  // The marker only appears after two sequential round-trips (points, then the
  // resolve that supplies the advertised position), so allow for both.
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  // The name is on the map, not only in the popup: the layer is opt-in.
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid')
  // §7: the disclaimer is on screen for as long as the layer is drawn.
  await expect(page.locator('#nodepos-note')).toBeVisible()
  await expect(page.locator('#nodepos-note')).toContainText('not GPS tracking')
  await expect(page).toHaveURL(/nodepos=1/)

  await page.locator('.np-advert').click({ force: true })
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toContainText('Repeater-Zuid')
  await expect(popup).toContainText('▲ advertised · ● estimated')
  await expect(popup).toContainText('self-reported')
})

test('a drift under 100 m reports a distance but claims no radius', async ({ page }) => {
  // ~46 m north of the estimate centre — inside the tight threshold, so the
  // popup states the drift but draws (and mentions) no circle.
  await routes(page, { lat: 51.0004, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)
  await page.locator('.np-advert').first().click({ force: true })
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toContainText(/drift \d+ m/)
  await expect(popup).not.toContainText('search radius')
  await expect(popup).not.toContainText('radius not trusted')
})

test('a one-sided estimate does not claim a search radius', async ({ page }) => {
  // Three points on one bearing only: encirclement stays below the 0.5 gate.
  const oneSided = [0, 1, 2].map((i) => ({
    lat: 51 + i * 0.0009, lon: 4, rssi: -70 - i, snr: -3, sender_id: SENDER, sender_kind: 'advert_pubkey', sender_label: '',
    hunter_name: 'ON8AR', packet_type: 'Advert', rx_at: '2026-07-19T10:00:00Z',
  }))
  await routes(page, { lat: 51.0025, lon: 4.0, points: oneSided })
  // Pin the view: with all points on one bearing the auto-fit (#218) is very
  // tight, which can push the advertised marker outside the viewport.
  await page.goto('/?lat=51.0012&lon=4.0&z=14')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1)
  await page.locator('.np-advert').click({ force: true })
  await expect(page.locator('.leaflet-popup-content')).toContainText('radius not trusted')
})

test('the layer is hidden from a guest, whose resolve responses carry no position', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  // Mirrors the server stripping lat/lon below member (httpapi/resolve.go).
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: ring(51, 4, 250, 8) } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({
    json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false },
  }))
  await page.goto('/')
  await expect(page.locator('.np-layer-toggle')).toBeHidden()
  await expect(page.locator('.np-advert')).toHaveCount(0)
})

test('the layer comes back after a Locate round-trip', async ({ page }) => {
  // Locate clears nodePosLayer out of band. The redraw afterwards recomputes
  // the same signature, so without resetting nodePosSig alongside the clear the
  // early return fires and the layer stays empty for the rest of the session.
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })

  await clickUntil(page, '#locate-toggle', () => page.locator('#locate-toggle.on').isVisible())
  await expect(page.locator('.np-advert')).toHaveCount(0)
  await clickUntil(page, '#locate-toggle', async () => (await page.locator('#locate-toggle.on').count()) === 0)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
})

test('a 64-hex id of a non-registry kind does not become an estimate for a node (#296)', async ({ page }) => {
  // sender_id can be 64 hex without being a pubkey — a full-length relay path
  // element, or an operator who named a channel that way. Since #377 the
  // registry decides what is drawn, so the marker appears either way; what must
  // not happen is those receptions pairing onto it as if we had heard the node.
  // Asserting "nothing is drawn" would now pass for the wrong reason (an
  // unstubbed registry answers nothing at all), so the registry IS stubbed here
  // and the assertion is about the pairing.
  await routes(page, {
    lat: 51.0005,
    lon: 4.0,
    points: ring(51, 4, 250, 8).map((p) => ({ ...p, sender_kind: 'relay' })),
  })
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('#nodepos-note')).toBeVisible()
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  // No ● and no connector: the relay receptions carried no attributable identity.
  await expect(page.locator('.np-estimate')).toHaveCount(0)
})

// #376: the layer used to end in an empty state four different ways, all of
// them silent. Each now says which one it was, and the disclaimer — which
// asserts that advertised positions are on screen — appears only with markers
// behind it.
test('with markers on screen it names the glyphs and disclaims them', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('#nodepos-key')).toContainText('▲ advertised position')
  await expect(page.locator('#nodepos-note')).toBeVisible()
})

for (const [label, fulfil, expected] of [
  ['the registry holds no positions', { status: 503, json: { error: 'registry_empty' } }, 'No positions from the node registry'],
  ['no registry is configured', { status: 503, json: { error: 'registry_not_configured' } }, 'no node registry configured'],
  ['the registry is unreachable', { status: 503, json: { error: 'registry_unavailable' } }, 'Node registry unreachable'],
  ['the server errors in a way we do not know', { status: 500, body: 'boom' }, 'Node registry unreachable'],
  ['the view is empty but the registry answered', { json: { nodes: [] } }, 'No registry nodes in this view'],
]) {
  test(`says so when ${label} (#376)`, async ({ page }) => {
    await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
    await page.route('**/api/nodes/positions*', (r) => r.fulfill(fulfil))
    await page.goto('/?mode=points')
    await setFilter(page, '#f-nodepos', true)
    await expect(page.locator('#nodepos-key')).toContainText(expected, { timeout: 10000 })
    // The disclaimer would claim positions are being shown. None are.
    await expect(page.locator('#nodepos-note')).toBeHidden()
    await expect(page.locator('.np-advert')).toHaveCount(0)
  })
}

test('marks a registry the server could not refresh (#376)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({
    json: { nodes: [{ pubkey: SENDER, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0 }], stale: true },
  }))
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  // Drawn, and dated: the positions are real, their age is not guaranteed.
  await expect(page.locator('#nodepos-key')).toContainText('positions may be a few minutes old')
  await expect(page.locator('#nodepos-note')).toBeVisible()
})

test('a guest who deep-links the layer is told it is the account (#376)', async ({ page }) => {
  // The control is hidden below member, but urlstate binds the checkbox from
  // ?nodepos=1 regardless — so this state is reachable and used to be silent.
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points&nodepos=1')
  await expect(page.locator('#nodepos-key')).toContainText('verified member account', { timeout: 10000 })
  await expect(page.locator('#nodepos-note')).toBeHidden()
})

test('a node nobody in this filter heard is still drawn (#377)', async ({ page }) => {
  // The acceptance criterion: with a filter matching zero receptions, the
  // registry still places every node in view. Before #377 the layer derived its
  // nodes from the filtered reception set, so this drew nothing at all.
  await routes(page, { lat: 51.0005, lon: 4.0, points: [] })
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid')
  await expect(page.locator('.np-estimate')).toHaveCount(0)
})

test('the registry slice follows the viewport, not the reception filter (#377)', async ({ page }) => {
  // One request per view, carrying the map's bbox — the bulk shape the server
  // endpoint is built around, not a per-node lookup.
  const urls = []
  await page.route('**/api/nodes/positions*', (r) => {
    urls.push(r.request().url())
    return r.fulfill({ json: { nodes: [{ pubkey: SENDER, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0 }] } })
  })
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  expect(urls.length).toBeGreaterThan(0)
  const bbox = new URL(urls[urls.length - 1]).searchParams.get('bbox')
  expect(bbox, 'bbox=minLat,minLon,maxLat,maxLon').toMatch(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
})

// #390: a draw that lands after Locate is on walks through every other guard and
// repaints markers into the focus view — activateLocate() clears the layer
// without bumping nodePosGen or unchecking the box, and refresh() is suppressed
// for the whole Locate session, so nothing clears them again until Locate is
// switched off. Held responses instead of parallel-load luck: this is the flake
// in "the layer comes back after a Locate round-trip", made deterministic.
//
// Re-pointed for #377. The original reproduction held /api/resolve, because the
// draw used to re-enter itself when its per-id position lookups settled. That
// path is gone — positions now arrive with the registry — so the window this
// holds open is the one that remains: the registry/points fetch the draw awaits
// before it paints. Same guard, same failure, a live reproduction rather than a
// vacuous pass.
function holdable(page, urlPattern, body) {
  let release
  const held = new Promise((res) => { release = res })
  return page.route(urlPattern, async (r) => {
    await held
    await r.fulfill({ json: body })
  }).then(() => release)
}

test('a registry fetch that lands after Locate does not repaint the layer into the focus view (#390)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: ring(51, 4, 250, 8) } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({
    json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false, lat: 51.0005, lon: 4.0 },
  }))
  const releaseRegistry = await holdable(page, '**/api/nodes/positions*',
    { nodes: [{ pubkey: SENDER, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0 }] })

  await page.goto('/?mode=points')
  await setFilter(page, '#f-nodepos', true)
  // The registry is in flight, so the draw is parked on its await and nothing
  // is on the map yet.
  await expect(page.locator('.np-advert')).toHaveCount(0)

  await clickUntil(page, '#locate-toggle', () => page.locator('#locate-toggle.on').isVisible())
  releaseRegistry()
  // The draw resumes inside focus mode and must stay out of it.
  await expect(page.locator('.np-advert')).toHaveCount(0)
  await page.waitForTimeout(600)
  expect(await page.locator('.np-advert').count(), 'no marker repainted into focus mode').toBe(0)

  // And the layer still comes back when Locate is switched off.
  await clickUntil(page, '#locate-toggle', async () => (await page.locator('#locate-toggle.on').count()) === 0)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
})

test('on a phone the disclaimer is a glance; on a desktop it stays', async ({ page }) => {
  // #426: the same 300px corner block is cheap on a desktop map and a quarter
  // of the viewport on a phone, over the part of the map being read. The key is
  // one line and never goes -- that is the half §7 requires.
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)

  const note = page.locator('#nodepos-note')
  const key = page.locator('#nodepos-key')
  await expect(note).toBeVisible()
  await expect(note).toBeHidden({ timeout: 10000 })
  await expect(key).toBeVisible()
  await expect(key).toContainText('▲')

  // Off and on again is a fresh glance, not a memory of the last one.
  await setFilter(page, '#f-nodepos', false)
  await setFilter(page, '#f-nodepos', true)
  await expect(note).toBeVisible()

  // Same page, wide: the prose stays put well past the glance.
  await page.setViewportSize({ width: 1280, height: 800 })
  await setFilter(page, '#f-nodepos', false)
  await setFilter(page, '#f-nodepos', true)
  await expect(note).toBeVisible()
  await expect(key).toBeVisible()
  await page.waitForTimeout(3000)
  await expect(note).toBeVisible()
})

// The path #426 is actually about. urlstate.bindControl restores the checkbox
// by assignment and dispatches nothing, so a layer that comes on from the URL
// or from restored localStorage never fires `change` -- and the glance used to
// be started from that listener alone. Every returning phone user who had the
// layer on last time landed here and got the permanent quarter-screen block
// this PR exists to remove. The toggle path above is the one where a user has
// just deliberately switched the layer on and is already looking at it.
test('a layer restored from the URL glances too, without a change event', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/?mode=points&nodepos=1')

  await expect(page.locator('#f-nodepos')).toBeChecked()
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  const note = page.locator('#nodepos-note')
  const key = page.locator('#nodepos-key')
  await expect(note).toBeVisible()
  await expect(note).toBeHidden({ timeout: 10000 })
  await expect(key).toBeVisible()
})

// The other half of the same gap: urlstate persists to localStorage under
// `ch-state`, so the second visit of a returning user restores the layer with
// no `?nodepos=1` in the URL at all.
test('a layer restored from localStorage glances too', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })

  // Plain revisit, no query string: the checkbox comes back from the store.
  await page.goto('/')
  await expect(page.locator('#f-nodepos')).toBeChecked()
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  const note = page.locator('#nodepos-note')
  await expect(note).toBeVisible()
  await expect(note).toBeHidden({ timeout: 10000 })
  await expect(page.locator('#nodepos-key')).toBeVisible()
})

// The glance's verdict is read at render time, so re-answering a media query
// changes nothing by itself -- something has to re-render. A resize does
// happen to reach drawNodePositions (setMapTop -> invalidateSize -> moveend ->
// refresh), which would make the query look handled while it is really the
// network round-trip doing it. So the registry is left hanging here: with no
// draw able to complete, the media listener is the only thing that can move
// the note, which is the point of using matchMedia rather than innerWidth.
test('rotating across the boundary re-decides the disclaimer without a redraw', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)

  const note = page.locator('#nodepos-note')
  const key = page.locator('#nodepos-key')
  await expect(note).toBeVisible()
  await expect(note).toBeHidden({ timeout: 10000 })

  // From here on no draw can finish.
  await page.route('**/api/nodes/positions*', () => {})

  // Turned to landscape: the block is a corner of a wide map again, so the
  // prose is affordable and comes back.
  await page.setViewportSize({ width: 900, height: 390 })
  await expect(note).toBeVisible()
  await expect(key).toBeVisible()

  // And back: the glance has already expired, so portrait takes it away again
  // rather than starting a second one.
  await page.setViewportSize({ width: 390, height: 780 })
  await expect(note).toBeHidden()
  await expect(key).toBeVisible()
})

// A glance is per activation, not per draw. The layer redraws on every pan,
// zoom and filter change, and restarting the clock there would put the prose
// back over the map the user is reading -- and on a phone refreshing faster
// than the glance, it would never expire at all.
test('a redraw after the glance does not bring the disclaimer back', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)

  const note = page.locator('#nodepos-note')
  await expect(note).toBeVisible()
  await expect(note).toBeHidden({ timeout: 10000 })

  // Watched rather than polled: a retrying toBeHidden() would simply wait out
  // a restarted glance and pass, which is the assertion this test is here to
  // avoid. The observer records any moment the note came back at all.
  await page.evaluate(() => {
    const el = document.getElementById('nodepos-note')
    window.__noteReturned = !el.hidden
    new MutationObserver(() => { if (!el.hidden) window.__noteReturned = true })
      .observe(el, { attributes: true, attributeFilter: ['hidden'] })
  })

  // Pan: moveend -> refresh() -> drawNodePositions(), a full redraw of the
  // layer with the note re-rendered at the end of it.
  const box = await page.locator('#map').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60, { steps: 8 })
  await page.mouse.up()
  await mapSettled(page)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  // Past a restarted glance, so a note put back by the redraw has been seen
  // and has had time to go again.
  await page.waitForTimeout(NODEPOS_GLANCE_MS + 500)

  expect(await page.evaluate(() => window.__noteReturned)).toBe(false)
  await expect(note).toBeHidden()
  await expect(page.locator('#nodepos-key')).toBeVisible()
})

test('overlapping names are dropped, and the markers they belong to are not', async ({ page }) => {
  // #425: every advertised node carried its name at full length whatever else
  // was nearby, so a real cluster printed them over each other. Four nodes a
  // few metres apart -- indistinguishable on screen at any usable zoom.
  const cluster = [0, 1, 2, 3].map((i) => ({
    pubkey: `cc${i}`.padEnd(64, '0'),
    name: `NL-DR-GTN-OBS0${i}`,
    lat: 51.0005 + i * 0.00002,
    lon: 4.0 + i * 0.00002,
  }))
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8), nodes: cluster })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)

  // Every node keeps its marker: decluttering hides names, never nodes.
  await expect(page.locator('.np-advert')).toHaveCount(4, { timeout: 15000 })
  const labels = page.locator('.np-label')
  const shown = await labels.count()
  expect(shown, 'some names must be dropped in a cluster this tight').toBeLessThan(4)
  expect(shown, 'and at least one must survive').toBeGreaterThan(0)

  // The ones that are drawn do not print over each other.
  const overlaps = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.np-label')].map((el) => el.getBoundingClientRect())
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    let n = 0
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) n++
    return n
  })
  expect(overlaps, 'labels drawn on top of each other').toBe(0)

  // The name of a node whose label was dropped is still reachable.
  await page.locator('.np-advert').first().click({ force: true })
  await expect(page.locator('.leaflet-popup-content')).toContainText('NL-DR-GTN-OBS0')
})

// The width the decluttering uses is measured, not estimated (#425 review).
// This is the case the first pass got wrong: an average glyph advance ran
// NARROW on uppercase names -- `NL-DR-GTN-OBS01` estimates 93.0 px and really
// draws 100.1 -- so a pair sitting 96 px apart was judged clear and printed
// over each other, on exactly the names the bug was reported for.
//
// The spacing is calibrated in the page rather than hard-coded, so the
// assertion does not depend on the zoom the map happens to settle at.
test('a pair the character estimate would call clear is decluttered on its real width', async ({ page }) => {
  const NAME = 'NL-DR-GTN-OBS0'
  const node = (i, lat, lon) => ({ pubkey: `cc${i}`.padEnd(64, '0'), name: `${NAME}${i}`, lat, lon })
  // Two calibration nodes a known distance apart in longitude, to read px/deg
  // off the live projection.
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8),
    nodes: [node(1, 51.0005, 4.0), node(2, 51.0005, 4.01)] })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(2, { timeout: 15000 })

  const pxPerDeg = await page.evaluate(() => {
    const xs = [...document.querySelectorAll('.np-advert')]
      .map((el) => el.getBoundingClientRect().left).sort((a, b) => a - b)
    return (xs[1] - xs[0]) / 0.01
  })
  expect(pxPerDeg, 'the two calibration markers must be distinguishable').toBeGreaterThan(100)

  // 96 px apart: wider than the 93.0 the estimate claims for this name, and
  // narrower than the 100.1 it actually occupies.
  const GAP_PX = 96
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({
    json: { nodes: [node(1, 51.0005, 4.0), node(2, 51.0005, 4.0 + GAP_PX / pxPerDeg)] },
  }))
  await setFilter(page, '#f-nodepos', false)
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-advert')).toHaveCount(2, { timeout: 15000 })

  // Both markers, one name. Under the estimate both names were drawn, 4 px of
  // the first sitting under the second.
  const measured = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.np-label')]
    const r = labels.map((el) => el.getBoundingClientRect())
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    let overlaps = 0
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (hit(r[i], r[j])) overlaps++
    return { shown: labels.length, overlaps, width: r.length ? +r[0].width.toFixed(1) : 0 }
  })
  expect(measured.shown, 'the second name must be dropped, not printed over the first').toBe(1)
  expect(measured.overlaps).toBe(0)
  // Pins the arithmetic above: if the drawn label stops being ~100 px wide,
  // 96 is no longer between the estimate and the truth and this test is
  // measuring something else.
  expect(measured.width).toBeGreaterThan(GAP_PX)
})

// The probe has to be invisible, out of the way, and still have a width to
// read. Same class as a real label for the font, so the rules that park it
// have to win over .np-label's own positioning.
test('the measuring probe is hidden and parked, and reads the label font', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await setFilter(page, '#f-nodepos', true)
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid', { timeout: 15000 })

  const probe = await page.evaluate(() => {
    const el = document.querySelector('.np-label-probe')
    if (!el) return null
    const label = document.querySelector('.np-label')
    const cs = getComputedStyle(el)
    return {
      insideMap: !!el.closest('.leaflet-container'),
      // Not counted as a drawn name by anything querying .np-label.
      countedAsLabel: el.matches('.np-label'),
      visibility: cs.visibility,
      left: cs.left,
      transform: cs.transform,
      sameFont: cs.font === getComputedStyle(label).font,
      // Not display:none -- a box with no layout has no width to measure.
      hasWidth: el.getBoundingClientRect().width >= 0 && cs.display !== 'none',
    }
  })
  expect(probe).not.toBeNull()
  expect(probe.insideMap, 'on document.body it would inherit the page font, not Leaflet\'s').toBe(true)
  expect(probe.visibility).toBe('hidden')
  expect(probe.left).toBe('-9999px')
  expect(probe.countedAsLabel).toBe(false)
  expect(probe.sameFont).toBe(true)
  expect(probe.hasWidth).toBe(true)
})
