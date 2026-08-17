import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  shouldShowOnboarding, useSpotlight, ONBOARDING_CALLOUTS, ONBOARDING_BASICS,
  ONBOARDING_TAGLINE, ONBOARDING_DISCLAIMER, ONBOARDING_TITLE,
} from './onboarding.js'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

describe('shouldShowOnboarding', () => {
  it('shows the tour to a reader who has never dismissed it', () => {
    expect(shouldShowOnboarding(null)).toBe(true)
    expect(shouldShowOnboarding('')).toBe(true)
  })
  it('stays out of the way once dismissed', () => {
    expect(shouldShowOnboarding('1')).toBe(false)
  })
})

describe('ONBOARDING_CALLOUTS', () => {
  // A callout anchored to an id that no longer exists is invisible with no
  // error — the tour silently loses a step. These are the ids the tour points
  // at, checked against the page it points at them on.
  it('points at controls that exist in index.html', () => {
    for (const co of ONBOARDING_CALLOUTS) {
      for (const id of co.targets) {
        expect(html, `callout ${co.id} targets #${id}`).toContain(`id="${id}"`)
      }
    }
  })

  it('has a box in index.html for every callout, and copy for every box', () => {
    for (const co of ONBOARDING_CALLOUTS) {
      expect(html).toContain(`id="${co.id}"`)
      expect(co.text.length).toBeGreaterThan(0)
    }
  })

  it('explains the hunter → member step, which has no self-service path', () => {
    const account = ONBOARDING_CALLOUTS.find((c) => c.id === 'wb-co-account')
    expect(account.text).toMatch(/hunter/i)
    expect(account.text).toMatch(/member/i)
    expect(account.text).toMatch(/admin/i)
  })
})

describe('panel copy', () => {
  it('carries the AGENTS.md §7 position disclaimer', () => {
    // The map implies node locations, so this is a hard rule, not a nicety:
    // the statement has to say what the position is inferred from and what it
    // is not.
    expect(ONBOARDING_DISCLAIMER).toMatch(/RSSI/)
    expect(ONBOARDING_DISCLAIMER).toMatch(/not GPS tracking/i)
  })
  it('is filled in', () => {
    expect(ONBOARDING_TITLE.length).toBeGreaterThan(0)
    expect(ONBOARDING_TAGLINE.length).toBeGreaterThan(0)
    expect(ONBOARDING_BASICS.length).toBeGreaterThan(0)
    for (const b of ONBOARDING_BASICS) expect(typeof b === 'string' && b.length > 0).toBe(true)
  })
})

describe('useSpotlight', () => {
  // The panel is min(380px, 100vw-48px) and centred, so on a phone it covers
  // the space the floating boxes would need. 760 is where a 380px panel stops
  // taking half the width.
  it('keeps the floating callouts on a desktop-width window', () => {
    expect(useSpotlight(1280)).toBe(true)
    expect(useSpotlight(760)).toBe(true)
  })
  it('falls back to the in-panel list on a phone', () => {
    expect(useSpotlight(759)).toBe(false)
    expect(useSpotlight(390)).toBe(false)
  })
})
