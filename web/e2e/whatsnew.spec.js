import { test, expect, openSettings } from './fixtures.js'

// A stand-in changelog.json so the assertions about which entries are marked
// new do not move every time the real file gains one. The real file is
// exercised by the last test in this spec (it must render) and by the unit
// tests in ../changelog.test.js.
const FIXTURE = [
  { id: '2026-08-15-newest', date: '2026-08-15', where: 'map', title: 'Newest thing', body: 'The newest body.' },
  { id: '2026-08-08-middle', date: '2026-08-08', where: 'both', title: 'Middle thing', body: 'The middle body.' },
  { id: '2026-08-01-oldest', date: '2026-08-01', where: 'app', title: 'Oldest thing', body: 'The oldest body.' },
]

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { role: 'member', username: 'm' } }))
  await page.route('**/api/points*', (r) => r.fulfill({ json: { points: [] } }))
  await page.route('**/api/heatmap*', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/api/hunters*', (r) => r.fulfill({ json: { hunters: [] } }))
})

function serveFixture(page) {
  return page.route('**/changelog.json*', (r) => r.fulfill({ json: FIXTURE }))
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
function bootstrap(page, seed) {
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
      if (v && v.entry) localStorage.setItem('ch-whatsnew-entry', v.entry)
      if (v && v.legacy) localStorage.setItem('ch-whatsnew-seen', v.legacy)
    } catch (_) {}
  }, seed)
}

test('a first visit gets no badge, and is recorded so the next one does not either', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, null)
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeHidden()
  // Recorded rather than left empty: without this, the first release after the
  // visit would look like "new since you were last here" to someone who has
  // never seen any of them.
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-entry'))).toBe('2026-08-15-newest')

  await page.reload()
  await expect(page.locator('#wn-dot')).toBeHidden()
})

test('an older acknowledged version badges the footer, and the panel marks what is new', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeVisible()

  await openSettings(page, null)
  const titles = page.locator('#wn-body .wn-version')
  await expect(titles).toHaveCount(3)
  // Only the entry published after the acknowledged one is new to this reader.
  await expect(page.locator('#wn-body .wn-new')).toHaveCount(1)
  await expect(titles.first()).toContainText('Newest thing')
  await expect(titles.first()).toContainText('new')
  await expect(titles.nth(1)).not.toContainText('new')

  // Plain prose, and the surface the change landed on — no scope prefix, no
  // issue number, which is the whole of #422.
  await expect(page.locator('#wn-body .wn-body-text').first()).toHaveText('The newest body.')
  await expect(page.locator('#wn-body .wn-where').first()).toHaveText('Map')
  await expect(page.locator('#wn-body')).not.toContainText('#343')

  // The feedback link is above the entries, not under them.
  const feedback = page.locator('#wn-body .wn-feedback')
  await expect(feedback).toHaveAttribute('href', /issues\/new/)
  expect(await feedback.evaluate((a, first) => a.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    await titles.first().elementHandle())).toBeTruthy()
})

test('opening the panel acknowledges the running version and clears the badge for good', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.goto('/')
  await openSettings(page, null)
  await expect(page.locator('#wn-dot')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-entry'))).toBe('2026-08-15-newest')

  await page.reload()
  await expect(page.locator('#wn-dot')).toBeHidden()
})

test('the panel closes on the Close button, on the scrim and on Escape', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.goto('/')
  const modal = page.locator('#settings-modal')

  await openSettings(page, null)
  await page.click('#ss-close')
  await expect(modal).toBeHidden()

  await openSettings(page, null)
  await modal.click({ position: { x: 5, y: 5 } }) // the scrim, not the card
  await expect(modal).toBeHidden()

  await openSettings(page, null)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('focus moves into the dialog and back out again', async ({ page }) => {
  // The card declares aria-modal, which tells assistive tech the rest of the
  // page is inert — so focus has to actually be inside it, and has to come back
  // to the trigger on close rather than being dropped at the document top.
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.goto('/')
  await openSettings(page, null)
  await expect(page.locator('#ss-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#settings-modal')).toBeHidden()
  await expect(page.locator('#settings-btn')).toBeFocused()
})

test('acknowledging clears the tooltip as well as the dot', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.goto('/')
  await expect(page.locator('#settings-btn')).toHaveAttribute('title', /updated since you last looked/)
  await openSettings(page, null)
  await expect(page.locator('#settings-btn')).toHaveAttribute('title', 'Settings, release notes and about')
})

test('the server-version fetch rewrites the version text without dropping the badge', async ({ page }) => {
  // Regression guard for the split that makes the badge possible: the footer
  // text is rewritten when /api/version answers, so the dot has to live outside
  // the span that gets rewritten.
  await serveFixture(page)
  await bootstrap(page, { entry: '2026-08-08-middle' })
  await page.route('**/api/version', (r) => r.fulfill({ json: { server: '9.9.9' } }))
  await page.goto('/')
  await expect(page.locator('#ch-version-text')).toContainText('srv v9.9.9')
  await expect(page.locator('#wn-dot')).toBeVisible()
})

test('the real changelog.json renders', async ({ page }) => {
  // No fixture here on purpose: this is the one test that fails if the shipped
  // file stops matching what the panel expects, or if a deploy leaves it
  // behind. The acknowledged id is one the file does not contain, so the dot
  // shows and nothing is marked new -- the honest answer, and the case
  // hasUnseenEntries and unseenEntryCount deliberately disagree on.
  await bootstrap(page, { entry: 'gone-from-the-file' })
  await page.goto('/')
  await openSettings(page, null)
  await expect(page.locator('#wn-body .wn-version').first()).not.toHaveText('')
  await expect(page.locator('#wn-body .wn-body-text').first()).not.toHaveText('')
  // Rendered as prose, not as raw markdown: no leftover link syntax or bold
  // markers anywhere in the panel.
  const text = await page.locator('#wn-body').innerText()
  expect(text).not.toMatch(/\]\(|\*\*|https?:\/\//)
})

test('a reader carrying the old version acknowledgement gets the dot once', async ({ page }) => {
  // The #422 migration, end to end. Someone who used the release-list panel has
  // been here before, so the rewritten notes are genuinely new to them -- but
  // the two acknowledgements live under different keys, and only the migration
  // connects them.
  await serveFixture(page)
  await bootstrap(page, { legacy: '1.4.0' })
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeVisible()
  // The old version string is carried into the new key. It is not an id in the
  // file, so it has no position: the dot shows and nothing is marked new.
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-entry'))).toBe('1.4.0')
  await openSettings(page, null)
  await expect(page.locator('#wn-body .wn-new')).toHaveCount(0)
  await page.click('#ss-close')

  await expect(page.locator('#wn-dot')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-entry'))).toBe('2026-08-15-newest')

  // And it stays down: the migration must not fire a second time.
  await page.reload()
  await expect(page.locator('#wn-dot')).toBeHidden()
})

test('a first-time reader is not badged, and the panel still works', async ({ page }) => {
  await serveFixture(page)
  await bootstrap(page, null)
  await page.goto('/')
  await expect(page.locator('#wn-dot')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ch-whatsnew-entry'))).toBe('2026-08-15-newest')
  await openSettings(page, null)
  await expect(page.locator('#wn-body .wn-version')).toHaveCount(3)
  await expect(page.locator('#wn-body .wn-new')).toHaveCount(0)
})
