import { test, expect, clickUntil, openSettings } from './fixtures.js'
import { ONBOARDING_CALLOUTS } from '../onboarding.js'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'guest' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

// One-shot setup, for the same reason as whatsnew.spec.js: an init script runs
// on every navigation, so clearing there would wipe the acknowledgement a
// reload is meant to prove survived.
function bootstrap(page, seen) {
  return page.addInitScript((s) => {
    try {
      if (sessionStorage.getItem('e2e-booted')) return
      sessionStorage.setItem('e2e-booted', '1')
      localStorage.clear()
      if (s) localStorage.setItem('ch-onboarding-seen', '1')
    } catch (_) {}
  }, seen)
}

test('a first visit opens the tour; dismissing it keeps it shut across a reload', async ({ page }) => {
  await bootstrap(page, false)
  await page.goto('/')
  const overlay = page.locator('#wb-onboarding')
  await expect(overlay).toBeVisible()
  await expect(page.locator('#wb-title')).toHaveText('Mesh-Hunter')
  await expect(page.locator('#wb-basics li')).not.toHaveCount(0)

  await page.click('#wb-got-it')
  await expect(overlay).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-onboarding-seen'))).toBe('1')

  await page.reload()
  await expect(overlay).toBeHidden()
})

test('a returning reader is not shown the tour, and the About entry brings it back', async ({ page }) => {
  await bootstrap(page, true)
  await page.goto('/')
  const overlay = page.locator('#wb-onboarding')
  await expect(overlay).toBeHidden()

  await openSettings(page, 'about')
  await clickUntil(page, '#help-btn', () => overlay.isVisible())
  // The sheet gets out of the way, or it would cover the controls the tour is
  // pointing at.
  await expect(page.locator('#settings-modal')).toBeHidden()
  await expect(page.locator('#help-btn')).toHaveAttribute('aria-expanded', 'true')

  // Closing is no longer a second click on the same control: since #420 that
  // control is inside the sheet, and opening the sheet is itself "operating
  // another control", which the tour already treats as a dismissal. So Escape
  // (or any ringed control) is the way out, and the entry goes back to
  // unexpanded with it.
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
  await expect(page.locator('#help-btn')).toHaveAttribute('aria-expanded', 'false')
})

test('each callout is anchored to the controls it describes, and they are ringed', async ({ page }) => {
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-onboarding')).toBeVisible()

  const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  // Anchored to a real control, not merely present: every callout is a 'below'
  // one, so its box must start under the control it points at and overlap it
  // horizontally. An unpositioned fixed box falls to its static spot at the top
  // of the page, which is above the toolbar and fails the first check — that is
  // the failure this asserts, since "is on screen" is true either way.
  for (const [id, anchor] of [['wb-co-filters', 'hp-toggle'], ['wb-co-mapping', 'rx-cta'], ['wb-co-account', 'auth-btn']]) {
    const box = page.locator(`#${id}`)
    await expect(box).toBeVisible()
    await expect(box).not.toHaveText('')
    const r = await box.boundingBox()
    const t = await page.locator(`#${anchor}`).boundingBox()
    expect(r.y, `${id} sits below #${anchor}`).toBeGreaterThanOrEqual(t.y + t.height)
    expect(r.x, `${id} overlaps #${anchor} horizontally`).toBeLessThanOrEqual(t.x + t.width + 8)
    expect(r.x + r.width).toBeGreaterThanOrEqual(t.x - 8)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(viewport.w)
    expect(r.y + r.height).toBeLessThanOrEqual(viewport.h)
  }

  // The spotlight ring is applied from the callouts' own target lists.
  for (const id of ['hp-toggle', 'tr-toggle', 'filter-pill', 'rx-cta', 'auth-btn']) {
    await expect(page.locator(`#${id}`)).toHaveClass(/wb-spot/)
  }
  // The toolbar is above the scrim, so the tour highlights live controls.
  // Scrim < toolbar < tour, and all three siblings — nesting the callouts
  // inside the scrim would trap them in its stacking context, painting the
  // toolbar over the boxes that point at it.
  const layers = await page.evaluate(() => {
    const z = (id) => Number(getComputedStyle(document.getElementById(id)).zIndex)
    const parentOf = (id) => document.getElementById(id).parentElement.tagName
    return { scrim: z('wb-scrim'), bar: z('bar'), tour: z('wb-onboarding'), sameParent: parentOf('wb-scrim') === parentOf('bar') && parentOf('wb-onboarding') === parentOf('bar') }
  })
  expect(layers.scrim).toBeLessThan(layers.bar)
  expect(layers.bar).toBeLessThan(layers.tour)
  expect(layers.sameParent).toBe(true)

  await page.click('#wb-close')
  await expect(page.locator('#hp-toggle')).not.toHaveClass(/wb-spot/)
})

test('the tour closes on the scrim and on Escape', async ({ page }) => {
  await bootstrap(page, true)
  await page.goto('/')
  const overlay = page.locator('#wb-onboarding')

  await openSettings(page, 'about')
  await clickUntil(page, '#help-btn', () => overlay.isVisible())
  await page.locator('#wb-scrim').click({ position: { x: 5, y: 400 } }) // the dimmed map
  await expect(overlay).toBeHidden()

  await openSettings(page, 'about')
  await clickUntil(page, '#help-btn', () => overlay.isVisible())
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('the account callout and the guest notice both name the hunter → member step', async ({ page }) => {
  // A hunter is the role you get by registering in the app, and the only way
  // past it is an admin — so it has to be readable without opening Settings.
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'hunter', username: 'h' } }))
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-co-account')).toContainText(/admin/i)
  await expect(page.locator('#wb-co-account')).toContainText(/member/i)
  await page.click('#wb-got-it')
  await expect(page.locator('#guest-notice')).toContainText(/your own companion/i)
  await expect(page.locator('#guest-notice')).toContainText(/admin/i)
})

// The band review found: wide enough that the old fixed 760px fallback did not
// trip, narrow enough that the centre panel still reached the boxes — all three
// sat behind it with their text clipped. Neither of the other viewports here
// (1280 and 420) covers it, which is why it survived.
for (const [w, h] of [[760, 800], [800, 800], [900, 700], [1024, 700]]) {
  test(`no callout is left behind the panel at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await bootstrap(page, false)
    await page.goto('/')
    await expect(page.locator('#wb-onboarding')).toBeVisible()
    const bad = await page.evaluate(() => {
      const panel = document.querySelector('.wb-panel').getBoundingClientRect()
      return ['wb-co-filters', 'wb-co-mapping', 'wb-co-account'].filter((id) => {
        const el = document.getElementById(id)
        if (el.hidden) return false
        const r = el.getBoundingClientRect()
        return r.left < panel.right && r.right > panel.left && r.top < panel.bottom && r.bottom > panel.top
      })
    })
    expect(bad).toEqual([])
    // Whatever the placement decided, the copy is readable exactly once: either
    // in boxes or in the panel, never in neither.
    const inlineShown = await page.locator('#wb-inline').isVisible()
    const boxesShown = await page.locator('#wb-co-filters').isVisible()
    expect(inlineShown).toBe(!boxesShown)
  })
}

test('a phone-width window drops the floating callouts into the panel', async ({ page }) => {
  // The centred panel is most of a narrow viewport, so three boxes beside the
  // toolbar would sit behind it — the copy moves inside instead.
  await page.setViewportSize({ width: 420, height: 780 })
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-onboarding')).toBeVisible()
  await expect(page.locator('#wb-inline li')).toHaveCount(3)
  for (const id of ['wb-co-filters', 'wb-co-mapping', 'wb-co-account']) {
    await expect(page.locator(`#${id}`)).toBeHidden()
  }
  // The controls are still ringed — the tour still points at live controls,
  // it just describes them in one place.
  await expect(page.locator('#hp-toggle')).toHaveClass(/wb-spot/)
  // Resizing back to a desktop width restores the spotlight.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('#wb-co-filters')).toBeVisible()
  await expect(page.locator('#wb-inline')).toBeHidden()
})

test('focus moves into the tour and back to a control that can take it', async ({ page }) => {
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-onboarding')).toBeVisible()
  await expect(page.locator('#wb-got-it')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#wb-onboarding')).toBeHidden()
  // Not #help-btn: on a first run the sheet has never been opened, so the
  // About entry is inside a hidden dialog and focusing it would drop focus to
  // the body. The settings button is the visible way back to it.
  await expect(page.locator('#settings-btn')).toBeFocused()
})

test('using a ringed control closes the tour instead of blocking it', async ({ page }) => {
  // The tour rings live controls and invites you to use them; a callout used to
  // sit over the popover the hunter picker opens, so its rows were unclickable
  // underneath the box that had just described them.
  await page.route('**/api/hunters*', (r) => r.fulfill({
    json: { hunters: [{ hunter_pubkey: 'abc123def456', hunter_name: 'ON8AR', count: 42 }] },
  }))
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-onboarding')).toBeVisible()

  await page.click('#hp-toggle')
  await expect(page.locator('#wb-onboarding')).toBeHidden()
  await expect(page.locator('#hunter-picker')).toBeVisible()
  // And the rows it lists are actually clickable, which is the thing that failed.
  await page.locator('#hp-list .tl-row').first().click({ timeout: 5000 })
  await expect(page.locator('#hp-list .tl-row').first()).toHaveAttribute('aria-pressed', 'true')
})

test('a callout never swallows a click meant for the map', async ({ page }) => {
  await bootstrap(page, false)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('#wb-co-filters')).toBeVisible()
  const passesThrough = await page.evaluate(() => {
    const r = document.getElementById('wb-co-filters').getBoundingClientRect()
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return at && at.id !== 'wb-co-filters'
  })
  expect(passesThrough).toBe(true)
})

test('no callout is placed over the bar it is describing', async ({ page }) => {
  // #428: positionCallouts seeded its blocker list with the centre panel only,
  // never #bar. Every callout is side:'below', so a box anchored to a control
  // on the bar's first row was placed straight over the bar's second row --
  // including #auth-btn, which is the target the third callout points at. The
  // tour hid the controls it was explaining, and avoidOverlap could not help,
  // because it was never told the bar was there.
  await bootstrap(page, false)
  await page.goto('/')
  const overlay = page.locator('#wb-onboarding')
  await expect(overlay).toBeVisible()

  // Two outcomes, both correct, and BOTH asserted (#458). This used to
  // `test.skip()` when the spotlight had fallen back to the inline panel, which
  // reported success without testing anything -- and it happened in a quarter
  // of runs on the configured viewport, not just on a narrow one: positionCallouts()
  // turns the spotlight off whenever a placed box still overlaps a blocker, and
  // #bar's height depends on content that lands after load. So a quarter of the
  // time the guard for #428 was not running, and the summary line said
  // `1 skipped` rather than anything alarming.
  const count = await page.locator('.wb-callout:not([hidden])').count()

  if (count === 0) {
    // Spotlight gave up: the copy has to be in the panel instead, or the tour
    // says nothing at all. One <li> per callout, same text.
    const inline = page.locator('#wb-inline')
    await expect(inline, 'spotlight fell back, so the inline panel must carry the copy').toBeVisible()
    await expect(inline.locator('li')).toHaveCount(ONBOARDING_CALLOUTS.length)
    return
  }

  const overlaps = await page.evaluate(() => {
    const bar = document.getElementById('bar').getBoundingClientRect()
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    return [...document.querySelectorAll('.wb-callout')]
      .filter((el) => !el.hidden)
      .map((el) => ({ id: el.id, over: hit(el.getBoundingClientRect(), bar) }))
      .filter((c) => c.over)
      .map((c) => c.id)
  })
  expect(overlaps, 'callouts sitting on top of #bar').toEqual([])
})

// #490 review, found by CI at a width this laptop does not reproduce: the bar
// wraps by content, so Start mapping and Log in are neighbours at one width and
// on separate rows at the next. A callout anchored to both was placed against
// the union of the two and landed in the empty space between them, 900px from
// either. One box per control fixes it, and this is the check that would have
// caught it: sweep the widths where the bar re-wraps and demand every box still
// sit under, and horizontally over, the control it describes.
// #490 review. The bar wraps by content, so which controls share a row moves
// with font metrics: CI placed Start mapping and Log in on separate rows at a
// width where this laptop keeps them together. A callout anchored to both was
// then positioned against the union of the two and landed in the empty middle,
// 900px from either button.
//
// This sweep is the cheap half of the guard: it walks the widths where the bar
// re-wraps and demands every visible box still sit under, and horizontally
// over, the control it describes. It does NOT reproduce the split on demand --
// forcing one (a margin, a narrower bar) either distorts the layout or drops
// the tour into its inline fallback, where there are no boxes to measure. What
// rules the shape out for good is the one-target-per-button assertion in
// onboarding.test.js; this catches the ordinary regressions.
for (const w of [1100, 1280, 1440]) {
  test(`every callout stays with its own control at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 })
    await bootstrap(page, false)
    await page.goto('/')
    await expect(page.locator('#wb-onboarding')).toBeVisible()
    // The spotlight is allowed to give up and fall back to the panel; what is
    // not allowed is a visible box away from its target.
    const placed = await page.evaluate((pairs) => {
      const out = []
      for (const [id, anchor] of pairs) {
        const el = document.getElementById(id)
        if (el.hidden) continue
        const r = el.getBoundingClientRect()
        const t = document.getElementById(anchor).getBoundingClientRect()
        out.push({ id, anchor, below: r.y >= t.y + t.height, overlaps: r.x <= t.x + t.width + 8 && r.x + r.width >= t.x - 8 })
      }
      return out
    }, [['wb-co-filters', 'hp-toggle'], ['wb-co-mapping', 'rx-cta'], ['wb-co-account', 'auth-btn']])
    for (const p of placed) {
      expect(p.below, `${p.id} sits below #${p.anchor}`).toBe(true)
      expect(p.overlaps, `${p.id} overlaps #${p.anchor} horizontally`).toBe(true)
    }
  })
}
