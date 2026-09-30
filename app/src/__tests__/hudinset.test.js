import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// #705. env(safe-area-inset-bottom, 18px) reads as "the inset, or 18px", but
// the 18px is only the fallback for a browser that does not know the
// variable. Android Chrome knows it and reports 0, so the HUD's buttons sat on
// the navigation bar with no space under them. The bottom edge now has one
// definition, a floor under the inset, and everything anchored to the bottom
// takes it.
//
// The stylesheets are not modules, so this reads them as text: the token in
// tokens.css, with the other :root tokens, and everything that stands on it
// in app.css.
const TOKENS = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
const rule = (selector) => {
  const m = CSS.match(new RegExp(`(^|\\n)${selector.replace(/[#.]/g, '\\$&')} \\{([^}]*)\\}`))
  return m ? m[2] : null
}

describe('the bottom edge has a floor on every device (#705)', () => {
  it('defines the edge once, as the inset with 14px under it at least', () => {
    expect(TOKENS).toMatch(/--ch-bottom-edge:\s*max\(env\(safe-area-inset-bottom\),\s*14px\);/)
    // Only the definition reads the inset: a second env() is a second answer.
    expect(TOKENS.match(/safe-area-inset-bottom/g)).toHaveLength(1)
    expect(CSS).not.toMatch(/safe-area-inset-bottom/)
  })

  it('pads the HUD by it', () => {
    expect(rule('#hud')).toMatch(/padding:\s*14px 16px var\(--ch-bottom-edge\);/)
  })

  it('stands the button stack and the splash close on it, so they rise with the HUD', () => {
    for (const [id, px] of [['#layer-toggle', 146], ['#discover-btn', 200], ['#recenter-btn', 254], ['#sound-toggle', 308], ['#nodepos-toggle', 362]]) {
      expect(rule(id), id).toMatch(new RegExp(`bottom: calc\\(var\\(--ch-bottom-edge\\) \\+ ${px}px\\)`))
    }
    expect(CSS).toMatch(/\.splash-close \{[^}]*bottom: calc\(var\(--ch-bottom-edge\) \+ 16px\)/)
  })
})
