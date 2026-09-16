import { test, expect, openPicker } from './fixtures.js'

// #386: #bar is flex-wrap and keeps growing after load — the packet chips
// render, the role notice arrives with /api/auth/me, the node counts and the
// server version land later — while setMapTop() measured it once at module
// load. #rx-log (z-index 620) then sits over the bar's last row (z-index 600)
// and takes the clicks meant for the bar's last-row control -- #settings-btn
// since #420, the version button before it.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  // Arrives after first paint and widens the version button, one of the things
  // that wraps the bar into another row.
  await page.route('**/api/version', (r) => r.fulfill({ json: { server: '9.9.9' } }))
})

const layout = (page) => page.evaluate(() => {
  const bar = document.getElementById('bar').getBoundingClientRect()
  const rx = document.getElementById('rx-log').getBoundingClientRect()
  const btn = document.getElementById('settings-btn').getBoundingClientRect()
  const top = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2)
  return {
    barBottom: bar.bottom,
    rxTop: rx.top,
    mapTop: document.getElementById('map').getBoundingClientRect().top,
    // Anything belonging to the button counts as reaching it -- the hit is its
    // inline <svg>, not the button itself. Resolved through closest() rather
    // than the element's own id/className: an SVGElement's className is an
    // SVGAnimatedString, so reading it yields an object, not a name.
    atButtonCentre: top ? (top.closest('button')?.id || top.tagName) : null,
  }
})

for (const [w, h] of [[1280, 720], [1280, 800]]) {
  test(`the receptions ticker stays clear of the bar at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    // Wait for the late content that grows the bar, then assert: the bug is a
    // stale measurement, so it only shows once the bar has outgrown it.
    // Still the signal that the late /api/version fetch has resolved, though
    // since #420 this text lives in the About tab and no longer widens the bar
    // itself. The role notice and the packet chips still do.
    await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
    const l = await layout(page)
    expect(l.rxTop, '#rx-log starts below #bar').toBeGreaterThanOrEqual(l.barBottom)
    expect(l.atButtonCentre, 'the settings button is the top element at its own centre')
      .toMatch(/settings-btn/)
    // #map is NOT asserted here: it stays on its pre-setView measurement on
    // purpose, because re-running invalidateSize after the initial view walks
    // the centre off the neutral world view (#218). The bar paints above it.
  })

  test(`the settings button opens the sheet at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
    // No force, no clickUntil: an unforced click that lands is the whole point.
    // Under the bug this times out, because .rx-hd intercepts the pointer.
    await page.locator('#settings-btn').click({ timeout: 5000 })
    await expect(page.locator('#settings-modal')).toBeVisible()
  })
}

// #322 widened the ticker into a full-width band, and .rx-ln takes pointer
// events, so the bar's own popovers — DOM children of #bar, painting in its
// stacking context — started losing clicks to it. Measured at 1280x720: the
// sender picker's second row sat under the first ticker row and
// elementFromPoint returned .rx-ln. Font-metric dependent, which is why it
// reproduced locally and not on CI's fonts, so this asserts the ordering
// itself as well as the click.
const TICK = {
  lat: 51, lon: 4, rssi: -90, snr: -8, sender_id: 'aa11bb22', sender_label: 'NEO7HI',
  hunter_pubkey: 'h1', hunter_name: 'Hunter 1', packet_type: 'Advert', rx_at: '2026-07-22T14:59:55Z',
}

test('a bar popover stays clickable over a populated ticker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.route('**/api/points*', (r) => r.fulfill({
    json: { points: [TICK, { ...TICK, sender_id: 'cc33dd44', sender_label: 'Charlie', rx_at: '2026-07-22T14:59:58Z' }] },
  }))
  await page.goto('/?mode=points')
  await openPicker(page, '#sp-toggle', '#sender-picker')
  await expect(page.locator('#tp-list .tl-row')).toHaveCount(2, { timeout: 10000 })
  await expect(page.locator('#rx-log .rx-ln').first()).toBeVisible()

  // Every row, not just the first: the overlap only reaches the ones far
  // enough down the panel to meet the ticker's playhead lane.
  const rows = page.locator('#tp-list .tl-row')
  for (let i = 0; i < await rows.count(); i++) {
    const hit = await rows.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return at ? at.closest('.tl-row') !== null : false
    })
    expect(hit, `picker row ${i} is the top element at its own centre`).toBe(true)
  }
  // And an unforced click lands, which is what the user does.
  await rows.nth(1).click({ timeout: 5000 })
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true')
})

test('the bar paints above the ticker, which is what keeps its popovers usable', async ({ page }) => {
  await page.goto('/')
  const z = await page.evaluate(() => ({
    bar: Number(getComputedStyle(document.getElementById('bar')).zIndex),
    rx: Number(getComputedStyle(document.getElementById('rx-log')).zIndex),
  }))
  expect(z.bar).toBeGreaterThan(z.rx)
})

// ---------------------------------------------------------------------------
// The bar as one row, at every width (#561)
// ---------------------------------------------------------------------------
//
// Measured on master as a guest at 375x812: 230px of bar over seven rows, 28%
// of the viewport, with 111px of map behind it. The cause is that #bar was
// flex-wrap and everything took part in the same flow -- controls, the guest
// notice, the role notice and four readouts. What follows pins the shape that
// replaced it rather than the pixel count, so a control added later fails here
// instead of quietly growing the bar again.

// The guest is the case that was worst and the one a shared link opens as: the
// two-line notice and the node counts are what took the bar to seven rows.
const asGuest = async (page) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 401, json: { error: 'unauthorised' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
  await page.route('**/api/version', (r) => r.fulfill({ json: { server: '9.9.9' } }))
}

const barShape = (page) => page.evaluate(() => {
  const bar = document.getElementById('bar')
  const shown = [...bar.children].filter((e) => e.id !== 'bar-filters' && !e.hidden
    && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0)
  const mid = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.y + b.height / 2) }
  const centres = shown.map(mid)
  return {
    height: Math.round(bar.getBoundingClientRect().height),
    ids: shown.map((e) => e.id || e.className),
    // One row means one centre line. Rows would show up as two clusters here
    // long before the height told you anything.
    centreSpread: centres.length ? Math.max(...centres) - Math.min(...centres) : 0,
    barVar: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ch-bar-h')),
  }
})

for (const [w, h, label] of [[375, 812, 'a phone'], [768, 1024, 'a tablet'], [1280, 800, 'a desktop']]) {
  test(`the bar is one row on ${label}, as a guest`, async ({ page }) => {
    await asGuest(page)
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    // Wait for the late arrivals that used to grow it: the guest notice and the
    // node counts both land after first paint.
    await expect(page.locator('#guest-notice')).toBeVisible()
    const s = await barShape(page)
    expect(s.centreSpread, `one centre line, got ${JSON.stringify(s.ids)}`).toBeLessThanOrEqual(2)
    expect(s.height, 'the bar is a row, not a block').toBeLessThanOrEqual(64)
    // And --ch-bar-h agrees with it, which is what everything else hangs off.
    expect(Math.abs(s.barVar - s.height), '--ch-bar-h matches the real bar').toBeLessThanOrEqual(1)
  })
}

// Every map control is in the FAB rail since #630, so every rail button is
// measured, not just zoom. The measurement the old test was built on:
// elementFromPoint at the centre of each button. On master at 375 as a guest,
// + returned #auth-btn and − returned #guest-notice, because the whole control
// was under the bar. Both roles, since the guest notice and the member's bar
// are different heights, and the sideways phone as well as the upright ones.
for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1280, 800], [844, 390]]) {
  for (const role of ['guest', 'member']) {
    test(`every rail button is reachable at ${w}x${h}, as a ${role}`, async ({ page }) => {
      if (role === 'guest') await asGuest(page)
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/')
      if (role === 'guest') await expect(page.locator('#guest-notice')).toBeVisible()
      await expect(page.locator('#rx-log')).toBeVisible()
      const hits = await page.evaluate(() => [...document.querySelectorAll('#map-rail button')].map((btn) => {
        const b = btn.getBoundingClientRect()
        const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
        return { id: btn.id, hit: top ? (top.closest('[id]')?.id || top.tagName) : null }
      }))
      expect(hits.map((x) => x.id)).toEqual(['zoom-in', 'zoom-out', 'compass-btn', 'view-toggle', 'nodepos-toggle'])
      for (const { id, hit } of hits) expect(hit, `#${id} is covered by ${hit}`).toBe(id)
    })
  }
}

// #630: the FAB rail is a column of five 46px buttons at the bottom right,
// 262px tall with 8px gaps. 844x390 holds it; a phone held sideways
// that is shorter than that ran it up under the bar (740x360: the bar's lower
// edge at 62, the rail's top at 54), and narrower than 760 its column stood on
// the right end of the ticker, where the cross and the chevron are. Narrower
// than 641 the ticker and the notices span the screen (#643), so the column
// stood on both: at 568x320 #zoom-in was under #settings-btn and the compass
// under the guest notice, and at 667x375 the notice's right end reached into
// the column. Every button is hit at its centre, not only the column's box.
// The buttons take the space left under the bar, between 36px and the app's
// 46px, and that is what is asserted, measured against the bar as it actually
// renders. Not a size per viewport: at 667x375 the space is within a pixel of
// 46, so a font that makes the bar taller (CI's system-ui does) shrinks the
// buttons there, which is the rule working. Only 844x390, with room to spare,
// is held to the full 46px.
for (const [w, h, fullSize] of [[844, 390, true], [740, 360], [667, 375], [640, 360], [568, 320]]) {
  test(`the rail fits a phone held sideways at ${w}x${h}, clear of the bar, the ticker and the notices`, async ({ page }) => {
    await asGuest(page)
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(page.locator('#rx-log')).toBeVisible()
    await expect(page.locator('#guest-notice')).toBeVisible()
    const g = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom } }
      const hits = [...document.querySelectorAll('#map-rail button')].map((btn) => {
        const b = btn.getBoundingClientRect()
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        return { id: btn.id, size: b.height, hit: top ? (top.closest('[id]')?.id || top.tagName) : null }
      })
      const rail = getComputedStyle(document.getElementById('map-rail'))
      return { bar: r('#bar'), rail: r('#map-rail'), ticker: r('#rx-log'), notice: r('#guest-notice'), hits,
        vh: innerHeight, barH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ch-bar-h')),
        railBottom: parseFloat(rail.bottom), gap: parseFloat(rail.rowGap) }
    })
    expect(g.rail.top, 'the rail runs up under the bar').toBeGreaterThanOrEqual(g.bar.bottom)
    const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
    expect(apart(g.rail, g.ticker), `rail ${JSON.stringify(g.rail)} over ticker ${JSON.stringify(g.ticker)}`).toBe(true)
    expect(apart(g.rail, g.notice), `rail ${JSON.stringify(g.rail)} under notice ${JSON.stringify(g.notice)}`).toBe(true)
    for (const { id, hit } of g.hits) expect(hit, `#${id} is covered`).toBe(id)
    // Five buttons and four gaps in what is left between 8px under the bar and
    // the rail's bottom offset, never under 36px and never over 46px.
    const fits = Math.min(46, Math.max(36, (g.vh - g.barH - 8 - g.railBottom - 4 * g.gap) / 5))
    for (const { id, size } of g.hits) expect(Math.abs(size - fits), `#${id} is ${size}px where ${fits}px fits`).toBeLessThan(0.1)
    if (fullSize) for (const { id, size } of g.hits) expect(size, `#${id} shrank`).toBe(46)
  })
}

// MapLibre opens the compact attribution expanded, and on a phone a longer
// credit (the terrain source's, in 3D) wraps it to two lines: 44px, so its top
// stood 10px above the rail's lower edge and the node-positions button sat on
// the text. Two lines of text are put in by hand, since the test basemap's
// credit is one short line.
test('the rail stays clear of an attribution that wraps to two lines on a phone', async ({ page }) => {
  await asGuest(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const g = await page.evaluate(() => {
    const attrib = document.querySelector('.maplibregl-ctrl-attrib')
    attrib.classList.remove('maplibregl-attrib-empty')
    attrib.classList.add('maplibregl-compact', 'maplibregl-compact-show')
    attrib.setAttribute('open', '')   // a <details>: MapLibre opens it with the class
    attrib.querySelector('.maplibregl-ctrl-attrib-inner').textContent =
      'MapLibre | OpenFreeMap © OpenMapTiles Data from OpenStreetMap | Terrain Tiles by Mapzen'
    const a = attrib.getBoundingClientRect()
    return { attribTop: a.top, attribHeight: a.height, railBottom: document.getElementById('map-rail').getBoundingClientRect().bottom }
  })
  expect(g.attribHeight, 'the credit is not two lines, so this measures something else').toBeGreaterThan(30)
  expect(g.attribHeight, 'the credit is not two lines, so this measures something else').toBeLessThan(50)
  expect(g.railBottom).toBeLessThanOrEqual(g.attribTop)
})

test('the bar names the product at every width', async ({ page }) => {
  await asGuest(page)
  await page.goto('/')
  // A scan of every leaf under #bar for the name returned nothing on master:
  // it lived in document.title and the walkthrough only.
  await expect(page.locator('#bar #brand-name')).toHaveText('Mesh-Hunter')
  await expect(page.locator('#bar #brand-mark')).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  // The mark stays at 375; the name is in the menu, the usual mobile app bar.
  await expect(page.locator('#bar #brand-mark')).toBeVisible()
  await expect(page.locator('#bar #brand-name')).toBeHidden()
})

test('what does not fit on a phone moves, rather than being hidden or copied', async ({ page }) => {
  await asGuest(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const where = (sel) => page.locator(sel).evaluate((el) => {
    const box = el.closest('#bar-controls, #bar-filters, #settings-modal, #bar')
    return box ? box.id : null
  })
  // The two the app's own group carries at this width stay in the bar.
  expect(await where('#sp-toggle')).toBe('bar-controls')
  expect(await where('#filter-pill')).toBe('bar-controls')
  // The rest is somewhere reachable, not display:none.
  expect(await where('#tr-toggle')).toBe('bar-filters')
  expect(await where('#hp-toggle')).toBe('bar-filters')
  expect(await where('#ig-toggle')).toBe('bar-filters')
  // The prefix field is inside the sender picker since #498, so it stays with
  // Select target rather than moving: one control for targets means one place
  // to reach it, at every width.
  expect(await where('#f-sender')).toBe('bar-controls')
  expect(await where('#rx-cta')).toBe('settings-modal')
  expect(await where('#auth-btn')).toBe('settings-modal')
  // Moved, not duplicated: one element each, whatever the width.
  for (const sel of ['#tr-toggle', '#hp-toggle', '#rx-cta', '#auth-btn']) {
    await expect(page.locator(sel), `${sel} exists once`).toHaveCount(1)
  }
})

test('the phone layout goes back when the window grows again', async ({ page }) => {
  await asGuest(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  const ids = await page.locator('#bar-controls').evaluate((el) =>
    [...el.children].filter((c) => c.getBoundingClientRect().width > 0).map((c) => c.id || c.className))
  // In their original order: the group draws one border with dividers between
  // its children, so a control back in the wrong place moves every divider.
  expect(ids).toEqual(['ms-wrap', 'ms-wrap', 'tr-wrap', 'filter-pill'])
  await expect(page.locator('#bar #rx-cta')).toBeVisible()
  await expect(page.locator('#bar #auth-btn')).toBeVisible()
})

// ---------------------------------------------------------------------------
// The readout and the attribution share the bottom-right corner
// ---------------------------------------------------------------------------
//
// #map-readout stood 26px up (24 on a phone), and MapLibre's compact
// attribution is a 24px line on a 10px margin in the same corner: measured
// with the real OpenFreeMap style on 14 September 2026, the readout covered
// the credit by 8px at 1280x800 and 844x390, by 10px at 390 and 375, and by
// all of its 25px in 3D on a phone, where the terrain source's credit wraps
// the line in two. Folded to its (i) button the credit was still under the
// readout's right end.
//
// The basemap is stubbed here, so the style below carries the real credit on a
// source a layer draws from: MapLibre then builds the control itself, opens
// it, and wraps it at the width of the real text. ?view=3d adds the DEM
// source and its credit, the longer case.
const CREDIT = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

const cornerBoxes = (page) => page.evaluate(() => {
  const box = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height })
  const attrib = document.querySelector('.maplibregl-ctrl-attrib')
  const inner = attrib.querySelector('.maplibregl-ctrl-attrib-inner')
  // The text itself, line by line: a Range's client rects are the glyph runs.
  const range = document.createRange()
  range.selectNodeContents(inner)
  return {
    open: attrib.classList.contains('maplibregl-compact-show'),
    attrib: box(attrib.getBoundingClientRect()),
    button: box(attrib.querySelector('summary').getBoundingClientRect()),
    text: [...range.getClientRects()].filter((r) => r.width > 0).map(box),
    readout: box(document.getElementById('map-readout').getBoundingClientRect()),
  }
})

const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top

for (const [w, h] of [[1280, 800], [844, 390], [390, 844], [375, 812]]) {
  for (const view of ['2d', '3d']) {
    test(`the readout stays off the attribution at ${w}x${h} in ${view}, open and folded`, async ({ page }) => {
      await page.route('**/tiles.openfreemap.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ version: 8,
          sources: { omt: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: CREDIT } },
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#111' } }, { id: 'omt', type: 'fill', source: 'omt' }] }) }))
      // The node counts make the readout as wide as it is in production; with
      // only the cell count it is too short to reach the credit's text.
      await page.route('**/corsproxy.on8ar.eu/sf7/**', (r) => r.fulfill({ json: { count: 1234 } }))
      await page.route('**/corsproxy.on8ar.eu/cs/**', (r) => r.fulfill({ json: { totalNodes: 5678 } }))
      await page.setViewportSize({ width: w, height: h })
      await page.goto(view === '3d' ? '/?view=3d' : '/')
      await expect(page.locator('#sf-counts')).toContainText('SF8')
      await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('OpenStreetMap')
      if (view === '3d') await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('DEM')

      // MapLibre opens the compact credit on load; that is the state the
      // readout covered, so it is asserted rather than assumed.
      const open = await cornerBoxes(page)
      expect(open.open, 'the credit opens on load').toBe(true)
      // Non-zero first: a 0x0 box is apart from everything.
      for (const [name, b] of [['readout', open.readout], ['attribution', open.attrib]]) {
        expect(b.width * b.height, `${name} has a box: ${JSON.stringify(b)}`).toBeGreaterThan(0)
      }
      expect(open.text.length, 'the credit has text on screen').toBeGreaterThan(0)
      expect(apart(open.readout, open.attrib),
        `readout ${JSON.stringify(open.readout)} over the open credit ${JSON.stringify(open.attrib)}`).toBe(true)
      for (const line of open.text) {
        expect(apart(open.readout, line), `readout ${JSON.stringify(open.readout)} over credit text ${JSON.stringify(line)}`).toBe(true)
      }

      // Folded, the way a drag on the map leaves it: the (i) button alone.
      await page.locator('.maplibregl-ctrl-attrib summary').click()
      const folded = await cornerBoxes(page)
      expect(folded.open, 'the credit folded').toBe(false)
      expect(folded.button.width * folded.button.height, `the (i) button has a box: ${JSON.stringify(folded.button)}`).toBeGreaterThan(0)
      expect(apart(folded.readout, folded.button),
        `readout ${JSON.stringify(folded.readout)} over the (i) button ${JSON.stringify(folded.button)}`).toBe(true)
    })
  }
}
