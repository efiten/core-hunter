import { test, expect, openFilters } from './fixtures.js'

// #634: what the map shows at a zoom is a share the style eases, not a step.
// Two cell sizes are on the map while one takes over from the other, the
// points come in over the hex, and Auto took the place of Both. The canvas
// has no DOM, so the page's hooks answer what a layer holds and is painted
// with. The numbers are pinned in zoomfade.test.js; this is the wiring.

const ring = [[3.99, 50.995], [4.01, 50.995], [4.015, 51], [4.01, 51.005], [3.99, 51.005], [3.985, 51], [3.99, 50.995]]
// Each cell counts as many receptions as its size, so a hover line names it.
const cell = (res, n = 1) => Array.from({ length: n }, (_, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
  properties: { cell: `${res}:${i}:1`, best_rssi: -85, count: res, hunters: ['h1'] } }))
const POINT = { lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'aa11bb22', sender_label: 'NEO7HI', hunter_pubkey: 'h1', hunter_name: 'Hunter 1',
  packet_type: 'Advert', rx_at: new Date(Date.now() - 5000).toISOString() }

// The server as it answers: the size asked for, up to `max`.
async function setup(page, { role = 'member', max = 18 } = {}) {
  const asked = { heatmap: [], points: [] }
  await page.route('**/api/auth/me', (r) => (role === 'guest'
    ? r.fulfill({ status: 401, json: { error: 'unauthorised' } })
    : r.fulfill({ json: { role, username: 'm' } })))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/heatmap*', (r) => {
    const z = Number(new URL(r.request().url()).searchParams.get('z'))
    asked.heatmap.push(z)
    const res = Math.min(z, max)
    // A size has as many cells as its number, so a count names the size.
    return r.fulfill({ json: { features: cell(res, res) } })
  })
  await page.route('**/api/points*', (r) => {
    const q = new URL(r.request().url()).searchParams
    if (q.get('bbox')) asked.points.push(q.get('z'))
    return r.fulfill({ json: { points: [POINT] } })
  })
  return asked
}
const count = (page, id) => page.evaluate((l) => window.__featureCount(l), id)
const paint = (page, id, prop) => page.evaluate(([l, p]) => window.__paint(l, p), [id, prop])

test('two cell sizes are asked for and drawn, each in its own layer', async ({ page }) => {
  const asked = await setup(page)
  // z=14 in the URL is MapLibre zoom 13: size 14 in full, with 15 above it.
  await page.goto('/?mode=hex&lat=51&lon=4&z=14')
  await expect.poll(() => count(page, 'hex')).toBe(14)
  await expect.poll(() => count(page, 'hex-b')).toBe(15)
  expect([...new Set(asked.heatmap)].sort()).toEqual([14, 15])
  // The pair hands over at 13.5; past that each holds on until the next pair.
  expect(await paint(page, 'hex', 'fill-opacity')).toEqual(['interpolate', ['linear'], ['zoom'],
    13.025, ['*', ['get', 'op'], 1], 13.975, ['*', ['get', 'op'], 0]])
  expect(await paint(page, 'hex-b', 'fill-opacity')).toEqual(['interpolate', ['linear'], ['zoom'],
    13.025, ['*', ['get', 'op'], 0], 13.975, ['*', ['get', 'op'], 1]])
  // The outline fades with its cells.
  expect(await paint(page, 'hex-outline', 'line-opacity')).toEqual(['interpolate', ['linear'], ['zoom'], 13.025, 0.9, 13.975, 0])
  await expect(page.locator('#status')).toContainText('14 cells')
})

// A linear interpolate over ['zoom'] at z, with the cell's own opacity at 1.
function shareAt(expr, z) {
  const val = (v) => (Array.isArray(v) ? v[2] : v)
  if (!Array.isArray(expr) || expr[0] !== 'interpolate') return val(expr)
  const stops = expr.slice(3)
  if (z <= stops[0]) return val(stops[1])
  for (let i = 0; i + 2 < stops.length; i += 2) {
    const [z0, v0, z1, v1] = [stops[i], val(stops[i + 1]), stops[i + 2], val(stops[i + 3])]
    if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0)
  }
  return val(stops[stops.length - 1])
}

test('a zoom past the fetched pair keeps its cells until the next pair arrives', async ({ page }) => {
  await setup(page)
  // z=14 is MapLibre zoom 13: sizes 14 and 15 fetched.
  await page.goto('/?mode=hex&lat=51&lon=4&z=14')
  await expect.poll(() => count(page, 'hex')).toBe(14)
  await expect.poll(() => count(page, 'hex-b')).toBe(15)
  // The refetch after the zoom never lands, so the pair of zoom 13 stays.
  await page.route('**/api/heatmap*', () => {})
  for (const z of [14.9, 11.5]) {
    await page.evaluate((to) => window.__mapJumpZoom(to), z)
    const a = shareAt(await paint(page, 'hex', 'fill-opacity'), z)
    const b = shareAt(await paint(page, 'hex-b', 'fill-opacity'), z)
    expect(a + b, `zoom ${z}`).toBeCloseTo(1, 2)
  }
})

test('the pointer reads the cell drawn in full, not the one faded out over it', async ({ page }) => {
  await setup(page)
  // MapLibre zoom 13: size 14 in full, 15 loaded above it at nothing.
  await page.goto('/?mode=hex&lat=51&lon=4&z=14')
  await expect.poll(() => count(page, 'hex-b')).toBe(15)
  const at = await page.evaluate(() => window.__mapProject(51, 4))
  const box = await page.locator('#map').boundingBox()
  await page.mouse.move(box.x + at.x, box.y + at.y)
  await page.mouse.move(box.x + at.x + 2, box.y + at.y + 1)
  await expect(page.locator('.ch-hover')).toContainText('14 pts')
})

test('a point takes a click from half its strength on', async ({ page }) => {
  await setup(page)
  const clickPoint = async () => {
    const at = await page.evaluate(() => window.__mapProject(51, 4))
    const box = await page.locator('#map').boundingBox()
    await page.mouse.click(box.x + at.x, box.y + at.y)
  }
  // MapLibre zoom 14: the point is drawn at 15%, so the cell under it answers.
  await page.goto('/?mode=auto&lat=51&lon=4&z=15')
  await expect.poll(() => count(page, 'points')).toBe(1)
  await clickPoint()
  await expect(page.locator('.maplibregl-popup:not(.ch-hover)')).toHaveCount(0)
  // MapLibre zoom 17: 75%, the point's own popup.
  await page.goto('/?mode=auto&lat=51&lon=4&z=18')
  await expect.poll(() => count(page, 'points')).toBe(1)
  await expect(async () => {
    await clickPoint()
    await expect(page.locator('.maplibregl-popup:not(.ch-hover)')).toContainText('RSSI -90', { timeout: 500 })
  }).toPass()
})

test('a size the server will not go past is drawn once, and stays in full', async ({ page }) => {
  // Below member the server caps the zoom: both asks come back as size 12.
  await setup(page, { role: 'guest', max: 12 })
  await page.goto('/?mode=hex&lat=51&lon=4&z=14')
  await expect.poll(() => count(page, 'hex')).toBe(12)
  expect(await count(page, 'hex-b')).toBe(0)
  // One size is the whole range: in full at every zoom, no ramp.
  expect(await paint(page, 'hex', 'fill-opacity')).toEqual(['*', ['get', 'op'], 1])
  expect(await paint(page, 'hex-b', 'fill-opacity')).toBe(0)
})

test('auto asks for no points below the zoom that shows them', async ({ page }) => {
  const asked = await setup(page)
  await page.goto('/?mode=auto&lat=51&lon=4&z=14')
  await expect.poll(() => count(page, 'hex')).toBe(14)
  expect(await count(page, 'points')).toBe(0)
  expect(asked.points).toEqual([])
  expect(await paint(page, 'points', 'circle-opacity')).toEqual(['interpolate', ['linear'], ['zoom'],
    13.25, ['*', ['get', 'op'], 0], 18.25, ['*', ['get', 'op'], 1]])

  // z=17 is MapLibre zoom 16: past 13.25, so the points are on the map.
  await page.goto('/?mode=auto&lat=51&lon=4&z=17')
  await expect.poll(() => count(page, 'points')).toBe(1)
  await expect.poll(() => count(page, 'hex')).toBeGreaterThan(0)
})

test('points mode draws the points at full strength at every zoom', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=points&lat=51&lon=4&z=10')
  await expect.poll(() => count(page, 'points')).toBe(1)
  expect(await paint(page, 'points', 'circle-opacity')).toEqual(['*', ['get', 'op'], 1])
  expect(await paint(page, 'points', 'circle-stroke-opacity')).toBe(1)
})

test('Auto took the place of Both, and a link from before still opens it', async ({ page }) => {
  await setup(page)
  await page.goto('/?mode=both&lat=51&lon=4&z=17')
  await expect.poll(() => count(page, 'points')).toBe(1)
  await openFilters(page)
  await expect(page.locator('#lm-auto')).toHaveText('Auto')
  await expect(page.locator('#lm-auto')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#lm-both')).toHaveCount(0)
})
