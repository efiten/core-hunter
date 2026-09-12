import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NARROW_SLOTS, NARROW_CONTAINERS, findControl } from './barnarrow.js'

// There is no jsdom in this suite (see focustrap.test.js), so the move itself is
// driven in e2e/barlayout.spec.js by a real browser at a real width. What is
// worth pinning here is the join between the table and the markup: every id in
// NARROW_SLOTS has to exist in index.html, and every control it names has to be
// in the bar's group to start with. Rename one and the move silently stops
// happening, with nothing failing and the control simply gone at 375px.

const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

// The slice of markup inside the element with this id, found by counting the
// tags that open and close after it. Crude, and enough: index.html is the file
// under test, not arbitrary HTML.
function within(html, id) {
  const at = html.indexOf(`id="${id}"`)
  if (at < 0) return ''
  const open = html.lastIndexOf('<', at)
  const tag = /^<([a-z]+)/.exec(html.slice(open))[1]
  let depth = 0
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g')
  re.lastIndex = open
  for (let m; (m = re.exec(html));) {
    depth += m[0][1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(open, m.index)
  }
  return html.slice(open)
}

describe('the narrow-bar slot table', () => {
  it('names slots and groups that index.html actually has', () => {
    expect(NARROW_SLOTS.length).toBeGreaterThan(0)
    for (const { slot, group } of NARROW_SLOTS) {
      expect(HTML, `#${slot} exists`).toContain(`id="${slot}"`)
      expect(HTML, `#${group} exists`).toContain(`id="${group}"`)
    }
  })

  it('puts every slot inside the container it claims', () => {
    // Not merely present: inside the element that opens it. A slot that ended
    // up outside both would move the control somewhere nothing ever shows --
    // the failure would be a control that simply vanishes at 375px.
    for (const { slot, into } of NARROW_SLOTS) {
      const id = NARROW_CONTAINERS[into]
      expect(id, `${into} is a known destination`).toBeTruthy()
      expect(within(HTML, id), `#${slot} is inside #${id}`).toContain(`id="${slot}"`)
    }
  })

  it('starts every moved control in the bar group', () => {
    const group = HTML.slice(HTML.indexOf('id="bar-controls"'), HTML.indexOf('id="bar-filters"'))
    // The selectors are how the module finds them, so assert the thing each one
    // keys on rather than the selector text.
    expect(group, 'the time range starts in the group').toContain('class="tr-wrap"')
    expect(group, 'the hunter picker starts in the group').toContain('id="hp-toggle"')
  })

  it('leaves Select target and Filters in the bar at every width', () => {
    // The two the app's own group carries at 375px, so the two this one keeps.
    const moved = NARROW_SLOTS.map((s) => s.control).join(' ')
    expect(moved).not.toContain('sp-toggle')
    expect(moved).not.toContain('filter-pill')
  })
})

describe('finding the control a slot moves', () => {
  // querySelector does not miss on a selector the engine cannot parse, it
  // throws a SyntaxError. applyNarrowBar looks every control up in one loop,
  // while map.js loads, so a single selector an engine cannot read stops the
  // hand-off with the bar half moved, and map.js with it. `:has()` is one,
  // before Firefox 121.
  //
  // This root reads only an id or a class, with at most one ancestor step, and
  // throws like an engine on anything else. The group's two wrappers are in the
  // opposite order to index.html, so the first `.ms-wrap` in the group is not
  // the hunter picker's and cannot pass for it.
  const parse = (sel) => {
    const parts = sel.trim().split(/\s+/)
    if (parts.length > 2 || !parts.every((p) => /^[#.][\w-]+$/.test(p))) {
      throw new SyntaxError(`'${sel}' is not a valid selector`)
    }
    return parts
  }
  const is = (n, part) => (part[0] === '#' ? n.id === part.slice(1) : n.classes.includes(part.slice(1)))
  const hasAncestor = (n, part) => {
    for (let at = n.parentElement; at; at = at.parentElement) if (is(at, part)) return true
    return false
  }
  const matches = (n, parts) => is(n, parts.at(-1)) && (parts.length === 1 || hasAncestor(n, parts[0]))
  const inOrder = (n) => [n, ...n.children.flatMap(inOrder)]

  function node(name, { id = '', classes = [] } = {}, children = []) {
    const n = { name, id, classes, children, parentElement: null }
    for (const c of children) c.parentElement = n
    n.closest = (sel) => {
      const parts = parse(sel)
      for (let at = n; at; at = at.parentElement) if (matches(at, parts)) return at
      return null
    }
    return n
  }

  const doc = node('document', {}, [
    node('bar', { id: 'bar' }, [
      node('group', { id: 'bar-controls' }, [
        node('target picker', { classes: ['ms-wrap'] }, [node('target toggle', { id: 'sp-toggle' })]),
        node('hunter picker', { classes: ['ms-wrap'] }, [node('hunter toggle', { id: 'hp-toggle' })]),
        node('time range', { classes: ['tr-wrap'] }),
      ]),
      node('Start mapping', { id: 'rx-cta' }),
      node('Log in', { id: 'auth-btn' }),
    ]),
  ])
  doc.querySelector = (sel) => {
    const parts = parse(sel)
    return inOrder(doc).find((n) => matches(n, parts)) || null
  }

  it('finds every control without a selector only some engines parse', () => {
    const found = NARROW_SLOTS.map((entry) => findControl(entry, doc)?.name)
    expect(found).toEqual(['time range', 'hunter picker', 'Start mapping', 'Log in'])
  })
})
