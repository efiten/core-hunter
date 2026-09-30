import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'

// landing/ had no CI job at all (#440, #441): it was the one directory in the
// repo where nothing was checked, so anything built here shipped unverified.
// These are the checks that would actually have caught a mistake, not a
// restatement of the markup.

const pages = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.html'))
const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')

describe('landing pages', () => {
  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(1)
  })

  // AGENTS.md §1: position is inferred, not GPS tracking of the target. The FAQ
  // answers "does the map show where my node is", so it explains that.
  it('faq.html carries the position disclaimer', () => {
    expect(read('faq.html')).toMatch(/inferred from radio measurements/)
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

// The site fetches nothing from another host (the v7 redesign). The display
// face is served from here for that reason, so a stylesheet or font that
// quietly points at a CDN would break the rule the fonts/ folder exists for.
describe('self-contained', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it.each(pages)('%s loads its stylesheet and icon from this site', (f) => {
    const links = [...read(f).matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(0)
    expect(links.filter((u) => /^(https?:)?\/\//i.test(u))).toEqual([])
  })

  it('points every url() in the stylesheet at a file that exists here', () => {
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1])
    expect(urls.length, 'no url() to check').toBeGreaterThan(0)
    for (const u of urls) {
      expect(u, `${u} is not local`).not.toMatch(/^(https?:)?\/\//i)
      expect(() => readFileSync(new URL(`./${u.replace(/^\//, '')}`, import.meta.url)), `${u} does not exist`).not.toThrow()
    }
    expect(css).not.toMatch(/@import/)
  })
})

// AGENTS.md §7: colours come from the --ch-* tokens. Three box-shadows carried
// a raw rgba() (review of #731), and a shadow is where the next one would go:
// it reads as an effect, not as a colour.
describe('colours', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens = [...css.matchAll(/--ch-[a-z0-9-]+\s*:\s*[^;]+;/g)]
  const rules = css.replace(/--ch-[a-z0-9-]+\s*:\s*[^;]+;/g, '')

  it('finds the token block, so stripping it strips something', () => {
    expect(tokens.length).toBeGreaterThan(20)
  })

  it('writes no colour value outside the token block', () => {
    expect(rules.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || []).toEqual([])
  })
})

// The four surfaces as tabs above one shot. The markup is what a reader
// without the script gets, so it has to be right on its own: one tab
// selected, its panel shown, the others hidden, and each tab naming a panel
// that exists.
describe('the tour', () => {
  const html = read('index.html')
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map((m) => ({
    controls: m[0].match(/aria-controls="([^"]+)"/)?.[1],
    selected: m[0].match(/aria-selected="([^"]+)"/)?.[1],
  }))
  const panel = (id) => html.match(new RegExp(`<div\\b[^>]*role="tabpanel"[^>]*id="${id}"[^>]*>`))?.[0]

  it('has a tab per surface, each with its own panel', () => {
    expect(tabs.length).toBe(4)
    for (const t of tabs) expect(panel(t.controls), `no panel ${t.controls}`).toBeTruthy()
  })

  it('selects one tab and shows only its panel', () => {
    expect(tabs.filter((t) => t.selected === 'true').length).toBe(1)
    for (const t of tabs) {
      expect(/\bhidden=/.test(panel(t.controls)), `${t.controls}`).toBe(t.selected !== 'true')
    }
  })

  it('describes each shot for a screen reader', () => {
    const shots = [...html.matchAll(/<svg\b[^>]*viewBox="0 0 640 470"[^>]*>/g)].map((m) => m[0])
    expect(shots.length).toBe(4)
    for (const s of shots) {
      expect(s).toMatch(/role="img"/)
      expect(s).toMatch(/aria-label="[^"]{40,}"/)
    }
  })

  // AGENTS.md §7: output that implies where a node is carries the
  // disclaimer, visible while it is (the review of #92). The Hunt & Locate
  // and Reach shots draw an estimated position, so their captions say what
  // that is.
  it.each(['panel-hunt', 'panel-reach'])('says under %s that a position is inferred, not tracked', (id) => {
    const at = html.indexOf(`id="${id}"`)
    expect(at).toBeGreaterThan(-1)
    const panel = html.slice(at, html.indexOf('</p>', at))
    expect(panel).toMatch(/inferred from RSSI and SNR, not from GPS tracking/)
  })
})

// The tour's behaviour, which the markup checks above cannot see: the page's
// own inline script, run against a stand-in for the four tabs and their
// panels. It is what decides when a panel is swapped under a reader, and it
// changed once (a click stopped the show, then did not) with no test noticing
// (review of #731).
describe('the tour as a slideshow', () => {
  const html = read('index.html')
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('.lp-tour'))
  const ids = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*id="([^"]+)"[^>]*aria-controls="([^"]+)"/g)].map((m) => ({ id: m[1], controls: m[2] }))

  // Just enough DOM for the script: elements that keep their listeners,
  // attributes and classes, and a document that finds them.
  function mount({ reducedMotion = false } = {}) {
    const el = (extra = {}) => {
      const listeners = {}, attrs = {}, classes = new Set()
      return {
        tabIndex: 0, hidden: false, focusVisible: false, dataset: {},
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
        fire(type, ev = {}) { for (const fn of listeners[type] || []) fn({ preventDefault() {}, ...ev }) },
        setAttribute(k, v) { attrs[k] = v }, getAttribute: (k) => attrs[k],
        matches(sel) { return sel === ':focus-visible' && this.focusVisible },
        focus() { this.fire('focus') },
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
        ...extra,
      }
    }
    const tour = el(), theme = el()
    const panels = Object.fromEntries(ids.map((t, i) => [t.controls, el({ hidden: i !== 0 })]))
    const tabs = ids.map((t, i) => {
      const tab = el()
      tab.setAttribute('aria-controls', t.controls)
      tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false')
      return tab
    })
    const document = {
      documentElement: el(),
      getElementById: (id) => (id === 'lp-theme' ? theme : panels[id]),
      querySelector: (sel) => (sel === '.lp-tour' ? tour : null),
      querySelectorAll: (sel) => (sel === '.lp-tab' ? tabs : []),
    }
    const window = { matchMedia: () => ({ matches: reducedMotion }) }
    new Function('document', 'window', 'localStorage', script)(document, window, { setItem() {} })
    const selected = () => tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
    const shown = () => ids.map((t) => !panels[t.controls].hidden)
    return { tour, tabs, selected, shown, playing: () => tour.classList.contains('is-playing') }
  }

  it('finds the script and the four tabs it drives', () => {
    expect(script).toBeTruthy()
    expect(ids.length).toBe(4)
  })

  it('moves to the next tab when the line under the active one has run out, and wraps', () => {
    const t = mount()
    expect(t.playing()).toBe(true)
    t.tabs[0].fire('animationend')
    expect(t.selected()).toBe(1)
    expect(t.shown()).toEqual([false, true, false, false])
    t.tabs[3].fire('animationend')
    expect(t.selected()).toBe(0)
  })

  it('stops for good when a tab is clicked, and shows the one that was picked', () => {
    // WCAG 2.2.2: a pointer, touch or screen-reader user needs a way to stop
    // it too, not only a keyboard user. Picking a tab is that way.
    const t = mount()
    t.tabs[2].fire('click')
    expect(t.selected()).toBe(2)
    expect(t.playing()).toBe(false)
    t.tabs[2].fire('animationend')
    expect(t.selected(), 'the panel was swapped under a reader who had picked it').toBe(2)
  })

  it('stops when the keyboard reaches a tab, and does not move on', () => {
    const t = mount()
    t.tabs[0].focusVisible = true
    t.tabs[0].fire('focus')
    expect(t.playing()).toBe(false)
    t.tabs[0].fire('animationend')
    expect(t.selected()).toBe(0)
  })

  it('stops on an arrow key and moves the selection with it', () => {
    const t = mount()
    t.tabs[0].fire('keydown', { key: 'ArrowLeft' })
    expect(t.playing()).toBe(false)
    expect(t.selected()).toBe(3)
    t.tabs[3].fire('keydown', { key: 'Home' })
    expect(t.selected()).toBe(0)
  })

  it('never starts for a reader who asked for less motion', () => {
    const t = mount({ reducedMotion: true })
    expect(t.playing()).toBe(false)
    t.tabs[0].fire('animationend')
    expect(t.selected()).toBe(0)
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
    expect(rules.length).toBeGreaterThan(3)
  })

  it.each(rules.map((r) => r.sel))('%s covers :visited', (sel) => {
    expect(sel).toMatch(/:visited/)
  })
})

// #490: a visitor who opens the map meets a login form with nothing to
// register against, so how to get an account has to be one click from the
// front page. Since the v7 redesign the steps live in the FAQ answer, the
// place the question is asked, and the front page links that answer.
describe('getting an account', () => {
  const faq = read('faq.html')
  const answer = (() => {
    const start = faq.indexOf('id="account"')
    return start === -1 ? '' : faq.slice(start, faq.indexOf('</details>', start))
  })()

  it('has its own FAQ answer, with the steps', () => {
    expect(answer).not.toBe('')
    expect(answer.match(/<li>/g)?.length ?? 0).toBeGreaterThan(3)
  })

  it('names the RX webapp as the only place that can register you', () => {
    expect(answer).toContain('https://rx.mesh-hunter.eu')
    expect(answer).toMatch(/companion/i)
  })

  it('names the admin step, which no amount of self-service replaces', () => {
    expect(answer).toMatch(/member/i)
    expect(answer).toMatch(/admin/i)
  })

  it('is linked from the front page', () => {
    expect(read('index.html')).toContain('href="/faq.html#account"')
  })
})

describe('fragment targets', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const faq = read('faq.html')
  const links = pages.flatMap((f) => [...read(f).matchAll(/href="\/faq\.html#([\w-]+)"/g)].map((m) => m[1]))

  it('links to FAQ answers that exist', () => {
    expect(links.length).toBeGreaterThan(0)
    for (const id of links) expect(faq, `#${id}`).toContain(`id="${id}"`)
  })

  // .lp-top is sticky, so a fragment jump parks the target heading underneath
  // it: the reader lands on a section whose title is hidden. The header is
  // 64px tall since the v7 redesign, so the reserve has to clear that.
  it('reserves more than the sticky header above a fragment target', () => {
    const header = Number(css.match(/\.lp-top \.lp-wrap\s*\{[^}]*height:\s*(\d+)px/)?.[1])
    expect(header).toBeGreaterThan(0)
    const rule = css.match(/:target\s*\{([^}]*)\}/)
    expect(rule, 'no :target rule').not.toBeNull()
    const px = Number(rule[1].match(/scroll-margin-top:\s*(\d+)px/)?.[1])
    expect(px).toBeGreaterThan(header)
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

// #383: the map and the app link the FAQ, and a link to one answer is worth
// more than a link to the page top. So every question carries an id, and the
// one the apps most need to point at, "what does auto-discover transmit", is
// on the page and says the one thing the reader came to check: zero-hop.
describe('faq anchors', () => {
  const html = read('faq.html')
  const list = html.slice(html.indexOf('class="faq-list"'), html.indexOf('</section>', html.indexOf('class="faq-list"')))
  const questions = [...list.matchAll(/<details([^>]*)>/g)].map((m) => m[1])

  it('gives every question a stable id', () => {
    expect(questions.length).toBeGreaterThan(5)
    const ids = questions.map((attrs) => attrs.match(/\bid="([a-z0-9-]+)"/)?.[1])
    for (const [i, id] of ids.entries()) expect(id, `question ${i + 1} has no id`).toBeTruthy()
    expect(new Set(ids).size, 'ids must be unique').toBe(ids.length)
  })

  it('answers what auto-discover transmits, and that it is zero-hop', () => {
    const at = html.indexOf('id="auto-discover"')
    expect(at, 'no #auto-discover question').toBeGreaterThan(-1)
    const answer = html.slice(at, html.indexOf('</details>', at))
    expect(answer).toMatch(/zero-hop/)
    expect(answer).toMatch(/Discover/)
  })
})
