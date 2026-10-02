import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { senderReadout } from '../hudsender.js'

// The HUD's two readout rows are CSS and markup glue no unit test reaches, so
// the rules that carry #637 and #618 are pinned against the files, the way
// floatreadout.test.js pins the letterbox and splash.test.js the FAB offsets.
// What they hold was measured in the browser (docs/2026-09-15-reading-layer.md).
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
// Every style rule, also one inside @media or @supports: the selector list is
// the text between the last "{" before the body and the body.
const rules = css.split('}')
  .map((chunk) => chunk.split('{'))
  .filter((parts) => parts.length >= 2)
  .map((parts) => ({
    selectors: parts[parts.length - 2].split(',').map((s) => s.trim()),
    body: parts[parts.length - 1],
  }))
const namesId = (id, text) => new RegExp(`#${id}(?![\\w-])`).test(text)
// A selector styles the element its last compound names. "#hud-snr",
// "#hud-readout-row > #hud-snr" and "#hud #hud-snr.x" all style the SNR, so a
// later, more specific rule for one state counts too; "#hud-sender .hud-via"
// styles a child of the sender, not the sender.
const subject = (selector) => selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || ''
const rulesStyling = (id) => rules.filter((r) => r.selectors.some((s) => namesId(id, subject(s))))
const where = (r) => r.selectors.join(', ')

describe('the HUD readout rows (#637, #618, #708)', () => {
  // #637: SNR shared the row's deficit with the sender (min-width:0 and an
  // ellipsis), so a long relay name cut it to "SNR -1…". Since #708 the
  // measurements have a row of their own, numbers of a known widest form, and
  // none of them gives up digits. No rule may take that back.
  for (const id of ['hud-snr', 'hud-noise']) {
    it(`never shrinks #${id} (#637)`, () => {
      const own = rulesStyling(id)
      expect(own.length, `app.css declares #${id}`).toBeGreaterThan(0)
      expect(own.some((r) => /(^|[;\s])flex:\s*none\s*(;|$)/.test(r.body))).toBe(true)
      for (const r of own) {
        expect(r.body, where(r)).not.toMatch(/text-overflow/)
        expect(r.body, where(r)).not.toMatch(/(^|[;\s])min-width:\s*0/)
        expect(r.body, where(r)).not.toMatch(/(^|[;\s])max-width:/)
        expect(r.body, where(r)).not.toMatch(/(^|[;\s])flex:(?!\s*none\s*(;|$))/)
        expect(r.body, where(r)).not.toMatch(/(^|[;\s])flex-shrink:(?!\s*0\s*(;|$))/)
      }
    })
  }

  // Kasper, 27 September (#708): who beside the number, the measurements
  // under it. The sender is the only thing in row 1 that can give up width,
  // and row 2 holds only numbers.
  it('puts the number and who in row 1, the measurements in row 2', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const ids = (rowId) => {
      const start = html.indexOf(`id="${rowId}"`)
      const body = html.slice(start, html.indexOf('\n    </div>', start))
      return [...body.matchAll(/\bid="(hud-[\w-]+)"/g)].map((m) => m[1]).filter((id) => id !== rowId)
    }
    expect(ids('hud-readout-row')).toEqual(['hud-dir', 'hud-rssi', 'hud-sender', 'hud-backlog'])
    expect(ids('hud-measure-row')).toEqual(['hud-snr', 'hud-noise', 'hud-since'])
  })

  // #hud is anchored to the bottom and the FAB rail sits a fixed distance above
  // it (#264), so a row that grows moves every button. The direction arrow
  // (#660) goes into row 1 and must not be able to do that.
  it('fixes the height of both readout rows, so an arrow cannot move the FAB rail', () => {
    for (const id of ['hud-readout-row', 'hud-measure-row']) {
      const row = rulesStyling(id)
      expect(row.some((r) => /(^|[;\s])height:\s*\d+(\.\d+)?px\s*(;|$)/.test(r.body)), `#${id} declares a px height`).toBe(true)
      for (const r of row) {
        for (const m of r.body.matchAll(/(?:^|[;\s])((?:min-|max-)?height):\s*([^;]*)/g)) {
          expect(`${m[1]}: ${m[2].trim()}`, where(r)).toMatch(/^height: \d+(\.\d+)?px$/)
        }
      }
    }
  })

  // The direction arrow (#660) comes and goes with its target and heading. It
  // is a fixed box, no taller than the row, so appearing never grows the row
  // and the number beside it moves over by the same width every time.
  it('gives the direction arrow a fixed box no taller than its row', () => {
    const dir = rulesStyling('hud-dir')
    expect(dir.length, 'app.css declares #hud-dir').toBeGreaterThan(0)
    expect(dir.some((r) => /(^|[;\s])flex:\s*none\s*(;|$)/.test(r.body))).toBe(true)
    const px = (prop) => {
      for (const r of dir) {
        const m = r.body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`))
        if (m) return Number(m[1])
      }
      return null
    }
    const rowHeight = (() => {
      for (const r of rulesStyling('hud-readout-row')) {
        const m = r.body.match(/(?:^|[;\s])height:\s*(\d+(?:\.\d+)?)px/)
        if (m) return Number(m[1])
      }
      return null
    })()
    expect(px('width'), '#hud-dir declares a px width').not.toBe(null)
    expect(px('height'), '#hud-dir declares a px height').not.toBe(null)
    expect(px('height')).toBeLessThanOrEqual(rowHeight)
  })

  // An ellipsis does nothing on the anonymous flex items of a flex container
  // (AGENTS.md 5.4 item 2), so the sender stays a block with inline children:
  // the text is cut from its end and the muted "via ~" before it survives. A
  // note ("No reception yet", "Unknown, no sender id") is cut the same way
  // beside the backlog pill, so no state of the line may undo the cut.
  it('cuts the sender line from its end, as a block and not a flex container', () => {
    const sender = rulesStyling('hud-sender')
    expect(sender.some((r) => /text-overflow:\s*ellipsis/.test(r.body))).toBe(true)
    expect(sender.some((r) => /(^|[;\s])min-width:\s*0/.test(r.body))).toBe(true)
    for (const r of sender) {
      expect(r.body, where(r)).not.toMatch(/(^|[;\s])display:\s*(inline-)?(flex|grid)/)
      expect(r.body, where(r)).not.toMatch(/text-overflow:(?!\s*ellipsis\s*(;|$))/)
      expect(r.body, where(r)).not.toMatch(/(^|[;\s])white-space:(?!\s*nowrap\s*(;|$))/)
      expect(r.body, where(r)).not.toMatch(/(^|[;\s])overflow:(?!\s*hidden\s*(;|$))/)
    }
  })

  // The signal tiers are for readings only (docs/design-system.md). A backlog
  // is the app's state, so it takes the UI's alert token at every level. Any
  // rule that names the pill counts: a level, a descendant, a child of it.
  it('colours the backlog with a UI token, never a signal tier', () => {
    const backlog = rules.filter((r) => r.selectors.some((s) => namesId('hud-backlog', s) || /\.hud-backlog-/.test(s)))
    expect(backlog.length, 'app.css declares #hud-backlog').toBeGreaterThan(0)
    for (const r of backlog) expect(r.body, where(r)).not.toMatch(/--ch-sig-/)
    expect(rulesStyling('hud-backlog').some((r) => /(^|[;\s])color:\s*var\(--ch-accent-2\)/.test(r.body))).toBe(true)
  })
})

// Before the first reception the numbers are empty and the sender line says
// so (#618). app.js boots after its module and config.json arrive, and on a
// slow network the HUD showed two blank rows for seconds, so the markup holds
// that state from the first frame. It is pinned to what senderReadout says and
// to how paintSender marks a note: the text alone, muted by class="empty".
describe('the HUD before app.js runs (#618)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const slot = (id) => html.match(new RegExp(`<div\\b([^>]*\\bid="${id}"[^>]*)>([^<]*)</div>`))

  it('says there is no reception yet, with empty numbers', () => {
    const sender = slot('hud-sender')
    expect(sender, 'index.html has #hud-sender holding text only').toBeTruthy()
    expect(sender[1]).toMatch(/\bclass="([^"]*\s)?empty(\s[^"]*)?"/)
    expect(sender[2]).toBe(senderReadout(null).text)
    for (const id of ['hud-rssi', 'hud-snr', 'hud-noise', 'hud-since']) {
      expect(slot(id), `index.html has #${id} holding text only`).toBeTruthy()
      expect(slot(id)[2], `#${id}`).toBe('')
    }
  })
})
