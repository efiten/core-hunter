import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  shouldShowOnboarding, ONBOARDING_CALLOUTS, ONBOARDING_BASICS,
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


// The RX webapp is the product the map is downstream of (2026-08-25): you map
// by pairing a companion to it, and this page is where everyone's results meet.
// A reader who arrives here first has no way to become a mapper unless the map
// says so, and the login card alone only reaches the ones who click Log in.
describe('the mapping call to action', () => {
  it('stands in the bar next to the login button, not only inside the login card', () => {
    const at = html.indexOf('id="rx-cta"')
    expect(at, 'no #rx-cta in the bar').toBeGreaterThan(-1)
    expect(html.slice(at - 200, at + 200)).toContain('https://rx.mesh-hunter.eu')
    expect(at).toBeLessThan(html.indexOf('id="auth-btn"'))
  })

  it('is explained by the tour, anchored to the control itself', () => {
    const account = ONBOARDING_CALLOUTS.find((c) => c.id === 'wb-co-account')
    expect(account.targets).toContain('rx-cta')
  })

  it('says in the panel where mapping happens, not only what the map shows', () => {
    const copy = [ONBOARDING_TAGLINE, ...ONBOARDING_BASICS].join(' ')
    expect(copy).toMatch(/RX webapp/i)
    expect(copy).toMatch(/companion/i)
  })
})
