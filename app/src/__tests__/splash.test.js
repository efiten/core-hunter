import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { splashState, splashRows, dismissBanner, SPLASH_ERRORS, SPLASH_DISCLAIMER, SPLASH_DISCLAIMER_SHORT, SPLASH_CALLOUTS, SPLASH_FAB_IDS, COACH_MARKS, APP_NAME } from '../splash.js'

describe('splashState', () => {
  it('hides once a GPS fix has been acquired, regardless of other state', () => {
    expect(splashState({ hasFix: true, connected: false, bleError: true, gpsError: true })).toBe('hidden')
  })
  it('shows intro before connecting', () => {
    expect(splashState({ hasFix: false, connected: false, bleError: false, gpsError: false })).toBe('intro')
  })
  it('shows ble-error when the last connect attempt failed, even if previously connected', () => {
    expect(splashState({ hasFix: false, connected: false, bleError: true, gpsError: false })).toBe('ble-error')
  })
  it('shows waiting-gps once connected but no fix yet and no GPS error', () => {
    expect(splashState({ hasFix: false, connected: true, bleError: false, gpsError: false })).toBe('waiting-gps')
  })
  it('shows gps-error once connected and the GPS watch reported an error', () => {
    expect(splashState({ hasFix: false, connected: true, bleError: false, gpsError: true })).toBe('gps-error')
  })
  // #539: the ✕ closes the gate for this session; connecting is not required.
  it('hides once dismissed, whatever else is going on', () => {
    expect(splashState({ hasFix: false, connected: false, bleError: true, gpsError: false, dismissed: true })).toBe('hidden')
    expect(splashState({ hasFix: false, connected: true, bleError: false, gpsError: true, dismissed: true })).toBe('hidden')
  })
})

// #539: the panel is two status rows (Bluetooth, GPS) — the same shape as the
// settings sheet's Connection block, because both guard the same two things.
describe('splashRows', () => {
  it('starts both rows grey with nothing claimed', () => {
    expect(splashRows('intro', {})).toEqual([
      { key: 'Bluetooth', dot: 'off', text: 'No companion' },
      { key: 'GPS', dot: 'off', text: 'No fix yet' },
    ])
  })
  it('ticks Bluetooth with the companion name and SF once connected, GPS still working', () => {
    expect(splashRows('waiting-gps', { name: 'Kas -2', sf: 7 })).toEqual([
      { key: 'Bluetooth', dot: 'on', text: 'Kas -2', extra: 'SF7' },
      { key: 'GPS', spin: true, text: 'Waiting for a fix…' },
    ])
  })
  it('falls back to a plain Connected when the companion has no name yet', () => {
    const [bt] = splashRows('waiting-gps', { name: '', sf: null })
    expect(bt).toEqual({ key: 'Bluetooth', dot: 'on', text: 'Connected', extra: null })
  })
  it('marks the failing row for each error state and leaves the other honest', () => {
    expect(splashRows('ble-error', {})).toEqual([
      { key: 'Bluetooth', dot: 'err', text: 'Not connected' },
      { key: 'GPS', dot: 'off', text: 'No fix yet' },
    ])
    expect(splashRows('gps-error', { name: 'Kas -2', sf: 8 })).toEqual([
      { key: 'Bluetooth', dot: 'on', text: 'Kas -2', extra: 'SF8' },
      { key: 'GPS', dot: 'err', text: 'No fix' },
    ])
  })
})

// #539 defect 4: whoever dismisses the gate before the first fix drives
// around while nothing is logged — the banner is the one reminder left.
describe('dismissBanner', () => {
  it('names the missing radio when nothing is connected', () => {
    expect(dismissBanner({ connected: false })).toBe('No companion connected. Showing your own captures.')
  })
  it('names the missing fix when the radio is already on', () => {
    expect(dismissBanner({ connected: true })).toBe('No GPS fix yet. Nothing is logged without a position.')
  })
})

describe('SPLASH_ERRORS', () => {
  it('has a fallback line for exactly the two retryable states', () => {
    expect(Object.keys(SPLASH_ERRORS).sort()).toEqual(['ble-error', 'gps-error'])
    for (const v of Object.values(SPLASH_ERRORS)) expect(v.length).toBeGreaterThan(0)
  })
})

describe('SPLASH_DISCLAIMER', () => {
  it('states we map radio signal, not GPS tracking of the target (AGENTS.md §7)', () => {
    expect(SPLASH_DISCLAIMER).toMatch(/RSSI|signal/i)
    expect(SPLASH_DISCLAIMER).toMatch(/not GPS tracking/i)
    expect(SPLASH_DISCLAIMER).toMatch(/where you were/i)
  })
})

// The gate's own disclaimer is one sentence (#413 allows a glance-length
// form); the full AGENTS.md wording stays in About via SPLASH_DISCLAIMER.
describe('SPLASH_DISCLAIMER_SHORT', () => {
  it('keeps the listens-only claim and the where-YOU-were rule in one line', () => {
    expect(SPLASH_DISCLAIMER_SHORT).toMatch(/listens only/i)
    expect(SPLASH_DISCLAIMER_SHORT).toMatch(/where .*you.* were/i)
  })
})

// #539/#384: three coach marks beside their own control, each pointing at a
// real element with a leader line — an arrow at nothing is not an arrow.
describe('COACH_MARKS', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  it('is three marks with copy, each anchored to an element index.html ships', () => {
    expect(COACH_MARKS).toHaveLength(3)
    for (const m of COACH_MARKS) {
      expect(m.html.length).toBeGreaterThan(0)
      expect(html).toContain(`id="${m.anchor}"`)
    }
  })
  it('sends the account mark to Settings, the one place that is live behind the gate', () => {
    const menu = COACH_MARKS.find((m) => m.anchor === 'settings-btn')
    expect(menu.html).toMatch(/register/i)
    expect(menu.html).toMatch(/settings/i)
  })
  it('names all five rail controls in the map-controls mark', () => {
    const rail = COACH_MARKS.find((m) => m.anchor === 'layer-toggle')
    const copy = rail.html.toLowerCase()
    for (const word of ['node locations', 'auto-ping', '2d/3d', 'drive mode', 'sound']) {
      expect(copy).toContain(word)
    }
  })
})

describe('SPLASH_CALLOUTS', () => {
  it('has copy for the three control groups', () => {
    expect(Object.keys(SPLASH_CALLOUTS).sort()).toEqual(['controls', 'fabs', 'menu'])
    for (const k of Object.keys(SPLASH_CALLOUTS)) expect(SPLASH_CALLOUTS[k].length).toBeGreaterThan(0)
  })
})

describe('SPLASH_CALLOUTS.fabs copy', () => {
  // SPLASH_CALLOUTS above only asserts the keys exist and are non-empty, so
  // dropping a button from the copy stayed green while leaving a ringed,
  // spotlit control unexplained — which is half of what #371 was about. Keyed
  // on each control's distinguishing word, not on the phrasing, so the sentence
  // can still be rewritten.
  const copy = SPLASH_CALLOUTS.fabs.toLowerCase()
  it.each(['view', 'discover', 'compass', 'sound', 'node positions'])('names the %s control', (word) => {
    expect(copy).toContain(word)
  })
})

describe('SPLASH_FAB_IDS', () => {
  // The spotlight lives in three files that must name the same buttons: this
  // list, the union positionCallouts() anchors the callout to, and the CSS that
  // lifts and rings them. #316 was exactly that drift — #nodepos-toggle was
  // ringed by the CSS and absent from the union — so the invariant is checked
  // against the real files rather than restated.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')

  it('names buttons that exist in index.html', () => {
    for (const id of SPLASH_FAB_IDS) expect(html).toContain(`id="${id}"`)
  })

  // The copy lists the buttons bottom-to-top, so the order of this list is
  // load-bearing — and the ring test below compares sorted sets, which cannot
  // see order. The CSS `bottom:` offsets are where the real order lives.
  it('is ordered bottom-to-top, matching the offsets in app.css', () => {
    const offsets = SPLASH_FAB_IDS.map((id) => {
      const rule = css.split('}').find((b) => b.includes(`#${id} {`) && b.includes('bottom:'))
      expect(rule, `#${id} has a bottom: offset`).toBeTruthy()
      return Number(/\+\s*(\d+)px\)/.exec(rule)[1])
    })
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('matches the set of FABs the onboarding CSS rings', () => {
    // The ring rule (box-shadow) is the spotlight; the topbar entries in it are
    // the two non-FAB targets, which have their own callouts.
    const rule = css.split('}')
      .map((block) => block.split('{'))
      .find(([sel, decls]) => sel?.includes('body.onboarding') && decls?.includes('box-shadow'))
    expect(rule).toBeTruthy()
    const ringed = [...rule[0].matchAll(/#([a-z0-9-]+)/g)].map((m) => m[1])
      .filter((id) => id !== 'topbar-controls' && id !== 'settings-btn')
    expect([...ringed].sort()).toEqual([...SPLASH_FAB_IDS].sort())
  })
})

describe('APP_NAME', () => {
  it('is the Mesh-Hunter display name', () => {
    expect(APP_NAME).toBe('Mesh-Hunter')
  })
})
