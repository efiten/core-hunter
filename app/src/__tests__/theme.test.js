import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { THEME_PREFS, resolveTheme, nextThemePref } from '../theme.js'

// The app shipped with one boolean: "Light theme" on or off, defaulting to the
// dark that index.html hardcodes (#563). That cannot say "follow the device",
// which is the state most people are actually in, and it is the state a fresh
// install should start in.
describe('resolveTheme', () => {
  it('follows the device while the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the device once a theme has been chosen', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  // The stored value is attacker-free but not shape-free: it survives
  // downgrades, hand edits and the older builds that wrote nothing at all.
  // Anything unrecognised means "no choice has been made", which is system.
  it('treats an unrecognised or absent preference as system', () => {
    for (const junk of [null, undefined, '', 'Light', 'auto', 'toString', 0]) {
      expect(resolveTheme(junk, true), `${String(junk)} with a dark device`).toBe('dark')
      expect(resolveTheme(junk, false), `${String(junk)} with a light device`).toBe('light')
    }
  })

  // matchMedia is absent in a non-browser context and its `matches` is
  // undefined before the query resolves. Neither may crash the boot path, and
  // dark is what index.html already paints, so it is the safer of the two.
  it('falls back to dark when the device preference is unknown', () => {
    expect(resolveTheme('system', undefined)).toBe('dark')
  })

  it('resolves every preference it offers to a real theme', () => {
    for (const pref of THEME_PREFS) {
      expect(['dark', 'light'], `${pref} resolves`).toContain(resolveTheme(pref, true))
    }
  })
})

// The control is a segmented one, but the FAB rail's grammar is a single button
// that swaps state, so the cycle has to exist for whichever the UI ends up
// using and has to be total.
describe('nextThemePref', () => {
  it('cycles through every preference and returns to the start', () => {
    const seen = []
    let pref = THEME_PREFS[0]
    for (let i = 0; i < THEME_PREFS.length; i++) { seen.push(pref); pref = nextThemePref(pref) }
    expect(seen.sort()).toEqual([...THEME_PREFS].sort())
    expect(pref).toBe(THEME_PREFS[0])
  })

  it('starts a cycle from an unrecognised value rather than sticking', () => {
    expect(THEME_PREFS).toContain(nextThemePref('nonsense'))
  })
})

// index.html sets data-theme inline, before the stylesheet paints, because
// app.js is a module and therefore runs too late to stop a stored light theme
// flashing dark first. That inline copy cannot import this module, so it
// restates the rule, and a restated rule is one that drifts. Rather than
// matching its source text, run it and compare its answer to resolveTheme's
// for every combination that can reach it.
describe("index.html's pre-paint script", () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const boot = /<script>([\s\S]*?core-hunter-theme[\s\S]*?)<\/script>/.exec(html)

  it('is present, and is the only place index.html names the theme key', () => {
    expect(boot, 'index.html carries a pre-paint theme script').toBeTruthy()
    expect(html.match(/core-hunter-theme/g)).toHaveLength(1)
  })

  // 'dark' is what index.html's own data-theme attribute already carries, so
  // that is what the script starts from and what it must leave in place when
  // it cannot do better.
  const runBoot = (stored, prefersDark) => {
    const documentElement = { dataset: { theme: 'dark' } }
    new Function('localStorage', 'matchMedia', 'document', boot[1])(
      { getItem: (k) => (k === 'core-hunter-theme' ? stored : null) },
      () => ({ matches: prefersDark }),
      { documentElement },
    )
    return documentElement.dataset.theme
  }

  it('agrees with resolveTheme on every stored value and device setting', () => {
    for (const stored of [null, 'system', 'dark', 'light', 'Light', 'nonsense', '']) {
      for (const prefersDark of [true, false, undefined]) {
        expect(runBoot(stored, prefersDark), `stored=${String(stored)} prefersDark=${String(prefersDark)}`)
          .toBe(resolveTheme(stored, prefersDark))
      }
    }
  })

  it('leaves the attribute alone when storage throws', () => {
    const documentElement = { dataset: { theme: 'dark' } }
    new Function('localStorage', 'matchMedia', 'document', boot[1])(
      { getItem() { throw new Error('SecurityError') } },
      () => ({ matches: false }),
      { documentElement },
    )
    expect(documentElement.dataset.theme).toBe('dark')
  })
})
