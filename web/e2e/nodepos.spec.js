import { test, expect, mapSettled, setNodePos, toggleLocate } from './fixtures.js'

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

// #641: the notice and the readout each owned a bottom corner, and a phone has
// only one. #631 empties the notice in the ordinary case, but not in the states
// that explain an absence — which are exactly the ones a reader has to be able
// to read. So the collision is pinned in one of those states.
test('the notice, the readout and the attribution share a phone screen without overlapping', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  // An unreachable registry: the layer is on, nothing is drawn, and the line
  // saying so stays up for as long as that is true (#307, docs/design-system.md).
  await page.route('**/api/nodes/positions*', (r) =>
    r.fulfill({ status: 503, json: { error: 'registry_unavailable' } }))
  // The reported case had a full readout, and the per-SF node counts are what
  // make it wide enough to reach the notice (index.html fills #sf-counts from
  // these two). Without them the readout is "8 points", which fits beside the
  // notice at 412px and would prove nothing.
  await page.route('**/sf7/api/nodes/count*', (r) => r.fulfill({ json: { count: 180 } }))
  await page.route('**/cs/api/stats*', (r) => r.fulfill({ json: { totalNodes: 1520 } }))
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await setNodePos(page, 'positions')
  await mapSettled(page)
  await expect(page.locator('#nodepos-key')).toBeVisible()
  await expect(page.locator('#sf-counts')).toContainText('1520 nodes')

  const { boxes, viewportH } = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { top: b.top, right: b.right, bottom: b.bottom, left: b.left }
    }
    return { boxes: { notice: box('#nodepos-stack'), readout: box('#map-readout'), rail: box('#map-rail') }, viewportH: window.innerHeight }
  })
  // A box that is missing, or laid out at zero size, passes every overlap test
  // below without measuring anything — which is how the first version of this
  // test passed with the fix removed.
  for (const [name, b] of Object.entries(boxes)) {
    expect(b, `${name} is in the DOM`).not.toBeNull()
    expect(b.right - b.left, `${name} has width`).toBeGreaterThan(0)
    expect(b.bottom - b.top, `${name} has height`).toBeGreaterThan(0)
  }

  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  expect(overlaps(boxes.notice, boxes.readout), 'notice over the readout').toBe(false)
  expect(overlaps(boxes.rail, boxes.readout), `rail over the readout ${JSON.stringify(boxes)}`).toBe(false)

  // The attribution itself cannot be measured here: the harness answers the
  // basemap style with a bare background that carries no sources, so
  // MapLibre's compact control renders empty and zero-wide. The strip it
  // occupies at the bottom of a real map is asserted instead, which is the
  // half of #641 that is not cosmetic.
  const ATTRIB_STRIP = 24
  expect(viewportH - boxes.notice.bottom, 'clearance under the notice for the attribution')
    .toBeGreaterThanOrEqual(ATTRIB_STRIP)
})

// #630 and #659: on a phone the rail's column stands at the readout's height,
// so the readout stops left of it, as on a wide screen. At 320px a guest's
// readout ("0 cells" and both node counts, 263px) does not fit in the 244px
// beside the column and wraps to a second line; the notice stands above that
// second line, not over it (Kasper, 16 September 2026).
test('a guest\'s readout stands left of the rail and under the notice on a 320px phone', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await routes(page, { lat: 51.0005, lon: 4.0, points: [] })
  await page.route('**/sf7/api/nodes/count*', (r) => r.fulfill({ json: { count: 180 } }))
  await page.route('**/cs/api/stats*', (r) => r.fulfill({ json: { totalNodes: 1520 } }))
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await expect(page.locator('#sf-counts')).toContainText('1520 nodes')
  await expect(page.locator('#status')).toContainText('cells')
  // A guest's tap shows the reason in the notice rather than the layer (#630).
  await page.locator('#nodepos-toggle').click()
  await expect(page.locator('#nodepos-key')).toBeVisible()
  const b = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON()
    return { notice: r('#nodepos-stack'), readout: r('#map-readout'), rail: r('#map-rail') }
  })
  const overlaps = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom
  expect(b.readout.width, 'the readout is empty, so this measures nothing').toBeGreaterThan(200)
  expect(b.readout.right, `readout into the rail's column ${JSON.stringify(b)}`).toBeLessThanOrEqual(b.rail.left)
  expect(overlaps(b.notice, b.readout), `notice over the readout ${JSON.stringify(b)}`).toBe(false)
  expect(overlaps(b.rail, b.readout), `rail over the readout ${JSON.stringify(b)}`).toBe(false)
  expect(b.readout.left, 'no gutter at the left edge').toBeGreaterThanOrEqual(8)
})

test('layer is off by default and the toggle is visible to a member', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  // In the FAB rail since #630, out of the filter panel.
  const fab = page.locator('#nodepos-toggle')
  await expect(fab).toBeVisible()
  await expect(fab).toHaveAttribute('aria-label', 'Node positions: off')
  await expect(fab).toHaveAttribute('aria-pressed', 'false')
})

test('checking it draws the advertised marker, names it on the map and reflects in the URL', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await setNodePos(page, 'positions')

  // Exactly one marker per node — concurrent redraws must not leave duplicates.
  // The marker only appears after two sequential round-trips (points, then the
  // resolve that supplies the advertised position), so allow for both.
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  // The name is on the map, not only in the popup: the layer is opt-in.
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid')
  await expect(page).toHaveURL(/[?&]nodepos=positions/)

  await page.locator('.np-advert').click({ force: true })
  const popup = page.locator('.maplibregl-popup-content')
  await expect(popup).toContainText('Repeater-Zuid')
  await expect(popup).toContainText('▲ advertised · ● estimated')
})

test('a drift under 100 m reports a distance but claims no radius', async ({ page }) => {
  // ~46 m north of the estimate centre — inside the tight threshold, so the
  // popup states the drift but draws (and mentions) no circle.
  await routes(page, { lat: 51.0004, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/')
  await setNodePos(page, 'positions')
  await page.locator('.np-advert').first().click({ force: true })
  const popup = page.locator('.maplibregl-popup-content')
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
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1)
  await page.locator('.np-advert').click({ force: true })
  await expect(page.locator('.maplibregl-popup-content')).toContainText('radius not trusted')
})

test('the layer is refused to a guest, whose resolve responses carry no position', async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  // Mirrors the server stripping lat/lon below member (httpapi/resolve.go).
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: ring(51, 4, 250, 8) } }))
  await page.route('**/api/resolve*', (r) => r.fulfill({
    json: { prefix: SENDER, pubkey: SENDER, name: 'Repeater-Zuid', ambiguous: false },
  }))
  await page.goto('/')
  // #629: the control stays where it used to be hidden outright, since refusing
  // it visibly is what tells a guest it exists. #630: a tap on the rail's
  // button says why and keeps the stop.
  const fab = page.locator('#nodepos-toggle')
  await expect(fab).toBeVisible()
  await fab.click()
  await expect(page.locator('#nodepos-key')).toContainText(/account/i)
  await expect(fab).toHaveAttribute('aria-pressed', 'false')
  // What the gate is for is unchanged: nothing is drawn.
  await expect(page.locator('.np-advert')).toHaveCount(0)
})

test('the layer comes back after a Locate round-trip', async ({ page }) => {
  // Locate clears nodePosLayer out of band. The redraw afterwards recomputes
  // the same signature, so without resetting nodePosSig alongside the clear the
  // early return fires and the layer stays empty for the rest of the session.
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/?mode=points')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })

  await toggleLocate(page) // Locate lives in the filter panel (#539)
  await expect(page.locator('.np-advert')).toHaveCount(0)
  await toggleLocate(page, false)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
})

test('a relay id longer than 3 bytes does not become an estimate for a node (#661)', async ({ page }) => {
  // sender_id can be 64 hex without being a pubkey: a full-length relay path
  // element. A relay id reaches a node only through its attribution by reach,
  // which covers ids of 1 to 3 bytes, and is never compared with a key, so
  // these receptions pair with nothing even though the id is the node's own.
  // Since #377 the registry decides what is drawn, so the marker appears
  // either way; asserting "nothing is drawn" would pass for the wrong reason
  // (an unstubbed registry answers nothing at all), so the registry IS stubbed
  // here and the assertion is about the pairing.
  await routes(page, {
    lat: 51.0005,
    lon: 4.0,
    points: ring(51, 4, 250, 8).map((p) => ({ ...p, sender_kind: 'relay' })),
  })
  await page.goto('/?mode=points')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  // No ● and no connector: the relay receptions carried no attributable identity.
  await expect(page.locator('.np-estimate')).toHaveCount(0)

  // The popup agrees: it names only the ▲, and like the estimate branch it
  // repeats no position notice (#662).
  await page.locator('.np-advert').first().click()
  const popup = page.locator('.maplibregl-popup')
  await expect(popup).toContainText('▲ advertised')
  await expect(popup).not.toContainText('estimated')
  await expect(popup).not.toContainText(/self-reported|inferred|GPS/i)
})

// #661: a relay id of 1 to 3 bytes pairs with the one registry node that has
// that prefix within reach of where it was heard (the reach at -90 dBm is the
// full 15 km), and with none when two are. The receptions ring the view's
// centre; the view is pinned so a node 5 km east lies outside it.
const RELAY_NODE = { pubkey: '4a4a' + 'be'.repeat(30), name: 'Heumensoord-RPT', lat: 51.0005, lon: 4.0 }
const relayRing = () => ring(51, 4, 250, 8).map((p) => ({ ...p, sender_id: '4a4a', sender_kind: 'relay', rssi: -90 }))

test('a 2-byte relay heard near the one node with that prefix pairs onto it (#661)', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: relayRing(), nodes: [RELAY_NODE] })
  await page.goto('/?mode=points&lat=51&lon=4&z=15')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('.np-estimate')).toHaveCount(1)
})

test('a relay with two candidate nodes in reach pairs with neither, the second one out of view (#661)', async ({ page }) => {
  // 5 km east: out of the view, so it gets no marker, and within the reach of
  // every reception, so it still refuses the pairing. The stub answers it
  // whatever bbox is asked; the padding itself is pinned further down.
  const elsewhere = { pubkey: '4a4a' + 'cd'.repeat(30), name: 'Elders-4a4a', lat: 51.0005, lon: 4 + 5000 / (111320 * Math.cos((51 * Math.PI) / 180)) }
  await routes(page, { lat: 51.0005, lon: 4.0, points: relayRing(), nodes: [RELAY_NODE, elsewhere] })
  await page.goto('/?mode=points&lat=51&lon=4&z=15')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('.np-label')).toHaveText('Heumensoord-RPT')
  await expect(page.locator('.np-estimate')).toHaveCount(0)
})

// #376: the layer used to end in an empty state four different ways, all of
// them silent. Each now says which one it was.
//
// #631 then took the glyph key off the map: with markers on screen the corner
// says nothing about them, and the popup's glyph line names the ▲ and the ●
// the reader tapped. #662 took the rest: no note over the map and no sentence
// in the popup repeating that positions are inferred. The splash and About
// say that once.
test('with markers on screen the popup names its glyphs and nothing repeats a notice', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8) })
  await page.goto('/?mode=points')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  // Nothing in the corner explains a glyph any more, whatever state it is in.
  await expect(page.locator('#nodepos-stack')).not.toContainText('▲')
  // Nor does it say that positions are inferred (#662). The stack as a whole,
  // so a note back beside the key is caught; and a drawn layer with a fresh
  // registry has nothing to report, so the key itself stays down.
  await expect(page.locator('#nodepos-stack')).not.toContainText(/inferred|GPS/i)
  await expect(page.locator('#nodepos-key')).toBeHidden()

  await page.locator('.np-advert').first().click()
  const popup = page.locator('.maplibregl-popup')
  await expect(popup).toContainText('advertised')
  await expect(page.locator('.maplibregl-popup .np-caveat')).toHaveCount(0)
  // The text, not only the class: a caveat re-added under any other element
  // still says one of these.
  await expect(popup).not.toContainText('self-reported')
  await expect(popup).not.toContainText(/inferred|GPS/i)
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
    await setNodePos(page, 'positions')
    await expect(page.locator('#nodepos-key')).toContainText(expected, { timeout: 10000 })
    await expect(page.locator('.np-advert')).toHaveCount(0)
  })
}

test('marks a registry the server could not refresh (#376)', async ({ page }) => {
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/nodes/positions*', (r) => r.fulfill({
    json: { nodes: [{ pubkey: SENDER, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0 }], stale: true },
  }))
  await page.goto('/?mode=points')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  // Drawn, and dated: the positions are real, their age is not guaranteed.
  await expect(page.locator('#nodepos-key')).toContainText('positions may be a few minutes old')
})

test('a guest who deep-links the layer is told it is the account (#376)', async ({ page }) => {
  // urlstate restores the stop from ?nodepos= whatever the role, so this
  // state is reachable and used to be silent.
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.goto('/?mode=points&nodepos=positions')
  await expect(page.locator('#nodepos-key')).toContainText('Log in to switch the layer on', { timeout: 10000 })
  // And it stays. The gate put the key up and unchecked the box; the refresh
  // it then asked for redrew from the box and took the key back 250 ms later,
  // so this used to pass only when the poll above fell inside that window
  // (2 in 6 full runs missed it). A retrying assertion cannot see a flash;
  // an observer armed before the next draw can, and the draw is forced rather
  // than waited for.
  await page.evaluate(() => {
    window.__keyHid = 0
    new MutationObserver(() => { if (document.getElementById('nodepos-key').hidden) window.__keyHid++ })
      .observe(document.getElementById('nodepos-key'), { attributes: true, attributeFilter: ['hidden'] })
  })
  const heat = page.waitForRequest('**/api/heatmap*')
  await page.evaluate(() => window.__refresh())
  await heat // the debounced draw ran: hex is fetched from the same tick as the node layer
  await expect(page.locator('#nodepos-key')).toContainText('Log in to switch the layer on')
  expect(await page.evaluate(() => window.__keyHid), 'the key was hidden by a later draw').toBe(0)
})

test('a node nobody in this filter heard is still drawn (#377)', async ({ page }) => {
  // The acceptance criterion: with a filter matching zero receptions, the
  // registry still places every node in view. Before #377 the layer derived its
  // nodes from the filtered reception set, so this drew nothing at all.
  await routes(page, { lat: 51.0005, lon: 4.0, points: [] })
  await page.goto('/?mode=points')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid')
  await expect(page.locator('.np-estimate')).toHaveCount(0)
})

test('the registry slice follows the viewport padded by the reach, not the reception filter (#377, #661)', async ({ page }) => {
  // One request per view, carrying the map's bbox — the bulk shape the server
  // endpoint is built around, not a per-node lookup. Since #661 the box is the
  // view widened by the 15 km reach on every side, so a candidate just outside
  // the view still counts; the stubs elsewhere answer whatever box is asked, so
  // this is the one test that sees the padding.
  const urls = []
  await page.route('**/api/nodes/positions*', (r) => {
    urls.push(r.request().url())
    return r.fulfill({ json: { nodes: [{ pubkey: SENDER, name: 'Repeater-Zuid', lat: 51.0005, lon: 4.0 }] } })
  })
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  // A town-sized view: with no points the map would stay on the whole world,
  // where the box runs past 180 degrees and the pads say little.
  await page.goto('/?mode=points&lat=51&lon=4&z=13')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
  expect(urls.length).toBeGreaterThan(0)
  // One more draw on the settled view, so the request and the bounds read below
  // describe the same view.
  await mapSettled(page)
  const asked = urls.length
  await page.evaluate(() => window.__refresh())
  await expect.poll(() => urls.length).toBeGreaterThan(asked)
  const view = await page.evaluate(() => window.__mapBounds())
  const bbox = new URL(urls[urls.length - 1]).searchParams.get('bbox')
  expect(bbox, 'bbox=minLat,minLon,maxLat,maxLon').toMatch(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
  const [minLat, minLon, maxLat, maxLon] = bbox.split(',').map(Number)
  // Kilometres of pad on each side; east and west measured along the view's
  // northern edge, where a degree of longitude is shortest.
  const KM_PER_DEG = 111.32
  const kmLon = KM_PER_DEG * Math.cos((view.north * Math.PI) / 180)
  const pads = {
    south: (view.south - minLat) * KM_PER_DEG,
    north: (maxLat - view.north) * KM_PER_DEG,
    west: (view.west - minLon) * kmLon,
    east: (maxLon - view.east) * kmLon,
  }
  for (const [side, km] of Object.entries(pads)) {
    expect(km, `${side} pad ${JSON.stringify({ view, bbox })}`).toBeGreaterThan(14.999)
    expect(km, `${side} pad is the reach, not a multiple`).toBeLessThan(16)
  }
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
  await setNodePos(page, 'positions')
  // The registry is in flight, so the draw is parked on its await and nothing
  // is on the map yet.
  await expect(page.locator('.np-advert')).toHaveCount(0)

  await toggleLocate(page) // Locate lives in the filter panel (#539)
  releaseRegistry()
  // The draw resumes inside focus mode and must stay out of it.
  await expect(page.locator('.np-advert')).toHaveCount(0)
  await page.waitForTimeout(600)
  expect(await page.locator('.np-advert').count(), 'no marker repainted into focus mode').toBe(0)

  // And the layer still comes back when Locate is switched off.
  await toggleLocate(page, false)
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 10000 })
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
  await setNodePos(page, 'positions')

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
  await expect(page.locator('.maplibregl-popup-content')).toContainText('NL-DR-GTN-OBS0')
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
  // off the live projection. The view is pinned around both: the layer draws
  // the nodes in view only (#661), and the fit to the ring alone ends short of
  // 4.01, where a real registry would not have answered the second node.
  await routes(page, { lat: 51.0005, lon: 4.0, points: ring(51, 4, 250, 8),
    nodes: [node(1, 51.0005, 4.0), node(2, 51.0005, 4.01)] })
  await page.goto('/?lat=51.0005&lon=4.005&z=16')
  await setNodePos(page, 'positions')
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
  await setNodePos(page, 'off')
  await setNodePos(page, 'positions')
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
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-label')).toHaveText('Repeater-Zuid', { timeout: 15000 })

  const probe = await page.evaluate(() => {
    const el = document.querySelector('.np-label-probe')
    if (!el) return null
    const label = document.querySelector('.np-label')
    const cs = getComputedStyle(el)
    return {
      insideMap: !!el.closest('#map'),
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

// #664. The server narrows /api/points to the bbox it is given, and the layer
// used to send the viewport's. A node's estimate was then made of the hearings
// on screen: 650 m between two views of one node was measured on the live map.
// The stub narrows the way the server does, so a bbox in the query shows up as
// a different estimate here too.
const bboxHonouring = (page, points, seen = []) =>
  page.route('**/api/points*', (r) => {
    const url = new URL(r.request().url())
    seen.push(url)
    const bbox = url.searchParams.get('bbox')
    if (!bbox) return r.fulfill({ json: { points } })
    const [s, w, n, e] = bbox.split(',').map(Number)
    return r.fulfill({ json: { points: points.filter((p) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e) } })
  })

const driftIn = async (page, view) => {
  await page.goto(`/?${view}`)
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  await page.locator('.np-advert').click({ force: true })
  const popup = page.locator('.maplibregl-popup-content')
  await expect(popup).toContainText(/drift \d+ m/)
  return (await popup.textContent()).match(/drift (\d+) m/)[1]
}

test('a node\'s estimate is the same whichever part of the map is in view (#664)', async ({ page }) => {
  await routes(page, { lat: 51.0005, lon: 4.0, points: [] })
  await bboxHonouring(page, ring(51, 4, 250, 8))
  // The whole ring on screen, then a view whose south edge cuts the ring in
  // half while the node itself stays in it.
  const whole = await driftIn(page, 'lat=51.0&lon=4.0&z=14')
  const half = await driftIn(page, 'lat=51.0045&lon=4.0&z=16')
  expect(half).toBe(whole)
})

test('a pan reuses the receptions the node layer already has (#664)', async ({ page }) => {
  const seen = []
  await routes(page, { lat: 51.0005, lon: 4.0, points: [] })
  await bboxHonouring(page, ring(51, 4, 250, 8), seen)
  await page.goto('/?lat=51.0&lon=4.0&z=14')
  await setNodePos(page, 'positions')
  await expect(page.locator('.np-advert')).toHaveCount(1, { timeout: 15000 })
  // The layer's own fetch is the paged one with no bbox; the ticker also asks
  // without a bbox, 200 rows at a time, and does so on every refresh.
  const windowFetches = () => seen.filter((u) => !u.searchParams.has('bbox') && u.searchParams.get('limit') === '5000').length
  expect(windowFetches()).toBe(1)

  const registry = page.waitForRequest('**/api/nodes/positions*')
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(520, 400, { steps: 4 }); await page.mouse.up()
  await registry // the node layer did redraw for the new view
  await mapSettled(page)
  expect(windowFetches()).toBe(1)
})
