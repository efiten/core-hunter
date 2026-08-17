import { test, expect, clickUntil } from './fixtures.js'

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

test('a returning reader is not shown the tour, and the ? button brings it back', async ({ page }) => {
  await bootstrap(page, true)
  await page.goto('/')
  const overlay = page.locator('#wb-onboarding')
  await expect(overlay).toBeHidden()

  await clickUntil(page, '#help-btn', () => overlay.isVisible())
  await expect(page.locator('#help-btn')).toHaveAttribute('aria-expanded', 'true')
  await page.click('#help-btn')
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
  for (const [id, anchor] of [['wb-co-filters', 'hp-toggle'], ['wb-co-layers', 'layer-toggle'], ['wb-co-account', 'auth-btn']]) {
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
  for (const id of ['hp-toggle', 'tr-toggle', 'layer-toggle', 'locate-toggle', 'auth-btn']) {
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

  await clickUntil(page, '#help-btn', () => overlay.isVisible())
  await page.locator('#wb-scrim').click({ position: { x: 5, y: 400 } }) // the dimmed map
  await expect(overlay).toBeHidden()

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

test('a phone-width window drops the floating callouts into the panel', async ({ page }) => {
  // The centred panel is most of a narrow viewport, so three boxes beside the
  // toolbar would sit behind it — the copy moves inside instead.
  await page.setViewportSize({ width: 420, height: 780 })
  await bootstrap(page, false)
  await page.goto('/')
  await expect(page.locator('#wb-onboarding')).toBeVisible()
  await expect(page.locator('#wb-inline li')).toHaveCount(3)
  for (const id of ['wb-co-filters', 'wb-co-layers', 'wb-co-account']) {
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
