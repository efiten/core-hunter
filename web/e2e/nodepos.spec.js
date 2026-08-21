import { test, expect, clickUntil } from './fixtures.js'

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
  await page.check('#f-nodepos')

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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
    await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
  await page.check('#f-nodepos')
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
