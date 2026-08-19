import { test, expect, clickUntil } from './fixtures.js'
// The deployed version, imported rather than retyped: release-please rewrites
// version.js on every web release without touching this spec, so a literal
// '1.5.0' here would go red on the release PR's own CI run (AGENTS.md §5.1).
import { VERSION } from '../version.js'

// A stand-in CHANGELOG.md so the assertions about which releases are marked new
// do not move every time the real file gains a release. The real file is
// exercised by the last test in this spec (it must parse and render) and by the
// unit tests in ../changelog.test.js.
const FIXTURE = `# Changelog

## [1.5.0](https://github.com/efiten/core-hunter/compare/web-v1.4.0...web-v1.5.0) (2026-08-15)


### Features

* **web:** newest thing ([#343](https://github.com/efiten/core-hunter/issues/343)) ([e924935](https://github.com/efiten/core-hunter/commit/e924935728c677241dafe369ef18508223a9c339))

## [1.4.0](https://github.com/efiten/core-hunter/compare/web-v1.3.2...web-v1.4.0) (2026-08-08)


### Bug Fixes

* **web:** middle thing ([#290](https://github.com/efiten/core-hunter/issues/290)) ([8e34c51](https://github.com/efiten/core-hunter/commit/8e34c51eeccd21e75e369475fc575e66b9cf6658))

## [1.3.2](https://github.com/efiten/core-hunter/compare/web-v1.3.1...web-v1.3.2) (2026-08-08)


### Bug Fixes

* **web:** oldest thing ([#280](https://github.com/efiten/core-hunter/issues/280)) ([1111111](https://github.com/efiten/core-hunter/commit/1111111111111111111111111111111111111111))
`

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

function serveFixture(page) {
  return page.route('**/CHANGELOG.md*', (r) => r.fulfill({ contentType: 'text/markdown', body: FIXTURE }))
}

// The map state persists through urlstate to localStorage, so a test that left
// state behind changes the starting point of the next one (#304); everything
// here is about a localStorage key, so a clean slate is the whole premise.
//
// It has to be a clean slate ONCE, though. An init script runs on every
// navigation, including page.reload() — clearing there would wipe the very
// acknowledgement a reload is meant to prove survived. The sessionStorage flag
// (per tab, kept across reloads) makes this the first-load-only setup it reads
// as.
function bootstrap(page, seenVersion) {
  return page.addInitScript((v) => {
    try {
      if (sessionStorage.getItem('e2e-booted')) return
      sessionStorage.setItem('e2e-booted', '1')
      localStorage.clear()
      // Re-set what the shared fixture put there: this script runs after it, so
      // the clear above also wipes the onboarding flag, and the first-run tour
      // would open over these tests — it takes focus on open (#316), which is
      // exactly what the focus assertions below measure.
      localStorage.setItem('ch-onboarding-seen', '1')
      if (v) localStorage.setItem('ch-whatsnew-seen', v)
    } catch (_) {}
  }, seenVersion)
}

test('a first visit gets no badge, and is recorded so the next one does not either', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, null)
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeHidden()
  // Recorded rather than left empty: without this, the first release after the
  // visit would look like "new since you were last here" to someone who has
  // never seen any of them.
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-seen'))).toBe(VERSION)

  await page.reload()
  await expect(page.locator('#wn-dot')).toBeHidden()
})

test('an older acknowledged version badges the footer, and the panel marks what is new', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeVisible()

  await clickUntil(page, '#ch-version', () => page.locator('#whatsnew-modal').isVisible())
  const versions = page.locator('#wn-body .wn-version')
  await expect(versions).toHaveCount(3)
  // Only the release published after the acknowledged one is new to this reader.
  await expect(page.locator('#wn-body .wn-new')).toHaveCount(1)
  await expect(versions.first()).toContainText('v1.5.0')
  await expect(versions.first()).toContainText('new')
  await expect(versions.nth(1)).not.toContainText('new')

  // Section headings and item text, with the commit link dropped and the issue
  // reference kept — i.e. the parse actually reached the page.
  await expect(page.locator('#wn-body .wn-section').first()).toHaveText('Features')
  await expect(page.locator('#wn-body .wn-items li').first()).toHaveText('web: newest thing (#343)')
})

test('opening the panel acknowledges the running version and clears the badge for good', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.goto('/')
  await clickUntil(page, '#ch-version', () => page.locator('#whatsnew-modal').isVisible())
  await expect(page.locator('#wn-dot')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-seen'))).toBe(VERSION)

  await page.reload()
  await expect(page.locator('#wn-dot')).toBeHidden()
})

test('the panel closes on the Close button, on the scrim and on Escape', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.goto('/')
  const modal = page.locator('#whatsnew-modal')

  await clickUntil(page, '#ch-version', () => modal.isVisible())
  await page.click('#wn-close')
  await expect(modal).toBeHidden()

  await clickUntil(page, '#ch-version', () => modal.isVisible())
  await modal.click({ position: { x: 5, y: 5 } }) // the scrim, not the card
  await expect(modal).toBeHidden()

  await clickUntil(page, '#ch-version', () => modal.isVisible())
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('focus moves into the dialog and back out again', async ({ page }) => {
  // The card declares aria-modal, which tells assistive tech the rest of the
  // page is inert — so focus has to actually be inside it, and has to come back
  // to the trigger on close rather than being dropped at the document top.
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.goto('/')
  await clickUntil(page, '#ch-version', () => page.locator('#whatsnew-modal').isVisible())
  await expect(page.locator('#wn-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#whatsnew-modal')).toBeHidden()
  await expect(page.locator('#ch-version')).toBeFocused()
})

test('acknowledging clears the tooltip as well as the dot', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.goto('/')
  await expect(page.locator('#ch-version')).toHaveAttribute('title', /updated since you last looked/)
  await clickUntil(page, '#ch-version', () => page.locator('#whatsnew-modal').isVisible())
  await expect(page.locator('#ch-version')).toHaveAttribute('title', "What's new")
})

test('the server-version fetch rewrites the version text without dropping the badge', async ({ page }) => {
  // Regression guard for the split that makes the badge possible: the footer
  // text is rewritten when /api/version answers, so the dot has to live outside
  // the span that gets rewritten.
  await serveFixture(page)
  await bootstrap(page, '1.4.0')
  await page.route('**/api/version', (r) => r.fulfill({ json: { server: '9.9.9' } }))
  await page.goto('/')
  await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
  await expect(page.locator('#wn-dot')).toBeVisible()
})

test('the real CHANGELOG.md parses into rendered releases', async ({ page }) => {
  // No fixture here on purpose: this is the one test that fails if the shipped
  // file stops matching the parser, or if a deploy leaves it behind.
  await bootstrap(page, '0.0.1')
  await page.goto('/')
  await clickUntil(page, '#ch-version', () => page.locator('#whatsnew-modal').isVisible())
  await expect(page.locator('#wn-body .wn-version').first()).toContainText(/^v\d+\.\d+\.\d+/)
  await expect(page.locator('#wn-body .wn-items li').first()).not.toHaveText('')
  // Rendered as prose, not as raw markdown: no leftover link syntax or bold
  // markers anywhere in the panel.
  const text = await page.locator('#wn-body').innerText()
  expect(text).not.toMatch(/\]\(|\*\*|https?:\/\//)
})
