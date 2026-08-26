import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'

// landing/ had no CI job at all (#440, #441): it was the one directory in the
// repo where nothing was checked, so anything built here shipped unverified.
// These are the checks that would actually have caught a mistake, not a
// restatement of the markup.

const pages = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.html'))
  .concat(readdirSync(new URL('./blog', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`))
const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')

describe('landing pages', () => {
  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(2)
  })

  // The house rule (#441). The em dash used as a "no value" placeholder is a
  // different character's job and lives in app/ and web/, not here, so on this
  // site any occurrence is prose.
  it.each(pages)('%s carries no em dash', (f) => {
    const line = read(f).split('\n').findIndex((l) => l.includes('—'))
    expect(line, `em dash on line ${line + 1}`).toBe(-1)
  })

  it.each(pages)('%s is well-formed markup', (f) => {
    // Not a validator: a parse is enough to catch the unclosed tag or stray
    // angle bracket that a hand-edited static page actually gets wrong.
    const parser = new XMLParser({ ignoreAttributes: false, unpairedTags: ['br', 'hr', 'img', 'link', 'meta', 'input'], processEntities: false })
    expect(() => parser.parse(read(f))).not.toThrow()
  })

  it.each(pages)('%s links only to files that exist', (f) => {
    const html = read(f)
    const local = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1])
      .filter((h) => h.endsWith('.html') || h.endsWith('.svg') || h.endsWith('.css'))
    for (const href of local) {
      const target = href.replace(/^\//, '')
      expect(() => readFileSync(new URL(`./${target}`, import.meta.url)), `${f} links to ${href}`).not.toThrow()
    }
  })
})

describe('the hero shot', () => {
  const svg = read('hero.svg')

  it('is self-contained: no network references', () => {
    // It is loaded through <img>, which blocks external subresources anyway --
    // so a remote reference would silently render nothing. The xmlns namespace
    // URI is not one: it is an identifier, never fetched, and matching it was
    // this test's own first bug.
    const fetched = [...svg.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1])
      .concat([...svg.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1]))
    expect(fetched.filter((u) => /^https?:/i.test(u))).toEqual([])
  })

  it('carries its own animation and honours reduced motion', () => {
    // One @keyframes per pillar: the phase is baked into the percentages rather
    // than set with animation-delay, so every pillar shares one timeline and
    // the scene can clear before the next drive starts.
    expect(svg.match(/@keyframes /g)?.length ?? 0).toBeGreaterThan(20)
    expect(svg).toMatch(/@keyframes drive/)
    expect(svg).toMatch(/prefers-reduced-motion/)
  })

  it('clears the trail before the drive restarts', () => {
    // The failure this guards: pillars still on screen when the hunter comes
    // round again, so each lap draws over the last one's coverage.
    const ends = [...svg.matchAll(/([\d.]+)%,100%\{transform:scaleY\(1\);opacity:0\}/g)]
    expect(ends.length, 'no pillar keyframe ends at opacity 0').toBeGreaterThan(20)
    for (const m of ends) expect(Number(m[1])).toBeLessThan(100)
  })

  it('describes itself for a screen reader', () => {
    expect(svg).toMatch(/role="img"/)
    expect(svg).toMatch(/aria-label="[^"]{40,}"/)
  })
})

describe('link colours', () => {
  // Comments stripped first: without it a comment sitting above a rule is read
  // as part of that rule's selector, and the test reports on prose.
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Every rule that colours a link has to colour :visited too. An author rule
  // naming only the base state leaves :visited to the UA -- browser blue, then
  // purple -- which is what happened when the product copy moved out of
  // .lp-card into .lp-feature (#441): #0000ee on a #0b0e14 background.
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim(), body }))
    // :hover / :focus / :active apply whatever the visited state, so they are
    // not part of this rule -- only the base-state rules are.
    .filter((r) => !/:(hover|focus|active)/.test(r.sel))
    .filter((r) => /(^|[\s,>])a(\.[\w-]+)?(\s|,|:|$)/.test(r.sel) && /(^|;)\s*color\s*:/.test(r.body))

  it('finds the link rules to check', () => {
    expect(rules.length).toBeGreaterThan(4)
  })

  it.each(rules.map((r) => r.sel))('%s covers :visited', (sel) => {
    expect(sel).toMatch(/:visited/)
  })
})

// #490: how you get an account was one sentence in the two-column block at the
// foot of the page, after the blog card. A visitor who clicks "Open the map"
// meets a login form with nothing to register against, so the answer belongs
// with the product sections it follows from, not in the small print.
describe('getting an account', () => {
  const html = read('index.html')
  const section = (() => {
    const start = html.indexOf('id="get-an-account"')
    return start === -1 ? '' : html.slice(start, html.indexOf('</section>', start))
  })()

  it('has a section of its own', () => {
    expect(section).not.toBe('')
  })

  it('names the RX webapp as the only place that can register you', () => {
    expect(section).toContain('https://rx.mesh-hunter.eu')
    expect(section).toMatch(/companion/i)
  })

  it('names the admin step, which no amount of self-service replaces', () => {
    expect(section).toMatch(/member/i)
    expect(section).toMatch(/admin/i)
  })

  it('sits with the product sections, not in the small print at the bottom', () => {
    // Where it used to live: one sentence inside "About & access", in the
    // two-column footer block after the blog card. This is the placement the
    // issue is about, so it is worth pinning.
    const at = html.indexOf('id="get-an-account"')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(html.indexOf('lp-sub'))
    expect(at).toBeLessThan(html.indexOf('lp-blogcard'))
  })
})

describe('in-page anchors', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const html = read('index.html')

  // .lp-top is sticky, so a fragment jump parks the target heading underneath
  // it: the reader lands on a section whose title is hidden. Measured at 59px
  // for the header, so the reserve has to clear that.
  it('reserves more than the sticky header above a fragment target', () => {
    expect([...html.matchAll(/href="#([\w-]+)"/g)].length).toBeGreaterThan(0)
    const rule = css.match(/:target\s*\{([^}]*)\}/)
    expect(rule, 'no :target rule').not.toBeNull()
    const px = Number(rule[1].match(/scroll-margin-top:\s*(\d+)px/)?.[1])
    expect(px).toBeGreaterThan(59)
  })
})

// The RX webapp is the product; the map is what it produces (2026-08-25). You
// map by pairing a companion to the RX webapp, and the map is where everyone's
// results meet. The page used to lead with the map, which sent a first-time
// visitor to a login screen for data they had no part in yet.
describe('the RX webapp leads', () => {
  const home = read('index.html')

  it.each(pages)('%s puts the RX webapp before the map in the nav', (f) => {
    const nav = read(f).match(/<nav class="lp-nav">[\s\S]*?<\/nav>/)[0]
    expect(nav.indexOf('rx.mesh-hunter.eu')).toBeLessThan(nav.indexOf('map.mesh-hunter.eu'))
  })

  it('makes mapping the primary call to action in the hero', () => {
    const cta = home.match(/<div class="lp-cta">[\s\S]*?<\/div>/)[0]
    const primary = cta.match(/<a class="lp-btn lp-btn-primary"[^>]*href="([^"]+)"/)
    expect(primary[1]).toContain('rx.mesh-hunter.eu')
    expect(cta.indexOf('lp-btn-primary')).toBeLessThan(cta.indexOf('map.mesh-hunter.eu'))
  })

  it('says what mapping is before it says what the map shows', () => {
    expect(home.indexOf('>The RX webapp<')).toBeLessThan(home.indexOf('>The map<'))
  })

  it('names the companion pairing in the hero, not three sections down', () => {
    const hero = home.match(/<section class="lp-hero">[\s\S]*?<\/section>/)[0]
    expect(hero).toMatch(/companion/i)
  })
})
