import { describe, it, expect } from 'vitest'
import { labelBox, unclutteredLabels, createLabelMeasurer, screenObstacles, LABEL_CHAR_PX, LABEL_HEIGHT_PX, LABEL_OFFSET_PX } from './nodelabels.js'

// Screen-space items, as map.js hands them over after projecting each node's
// advertised position. `label` is the text actually rendered next to the ▲.
const at = (id, x, y, label = 'NL-DR-GTN-OBS01') => ({ id, x, y, label })

describe('labelBox', () => {
  it('sits to the right of the marker, vertically centred on it', () => {
    const b = labelBox(at('a', 100, 200, 'abc'))
    expect(b.left).toBe(100 + LABEL_OFFSET_PX)
    expect(b.top).toBe(200 - LABEL_HEIGHT_PX / 2)
    expect(b.height).toBe(LABEL_HEIGHT_PX)
  })
  it('scales its width with the text, since the labels are names of very different lengths', () => {
    expect(labelBox(at('a', 0, 0, 'ab')).width).toBeLessThan(labelBox(at('a', 0, 0, 'abcdefgh')).width)
    expect(labelBox(at('a', 0, 0, 'abcd')).width).toBeCloseTo(4 * LABEL_CHAR_PX, 5)
  })
  it('gives a missing label no width, so it can never block a real one', () => {
    expect(labelBox({ id: 'a', x: 0, y: 0 }).width).toBe(0)
  })
})

describe('unclutteredLabels', () => {
  it('labels everything when nothing collides', () => {
    expect(unclutteredLabels([at('a', 0, 0), at('b', 0, 400), at('c', 0, 800)]))
      .toEqual(['a', 'b', 'c'])
  })

  it('drops a label whose box would land on one already placed', () => {
    // 4 px apart vertically: well inside a 13 px tall box.
    expect(unclutteredLabels([at('a', 100, 200), at('b', 104, 204)])).toEqual(['a'])
  })

  // The subtle half. A label that was skipped is not on screen, so it cannot
  // hide anything -- if skipped boxes stayed in the blocker set, one dense
  // cluster would go on suppressing labels far outside it.
  it('does not let a skipped label block a later one', () => {
    const kept = unclutteredLabels([
      at('a', 100, 200),   // placed
      at('b', 104, 206),   // skipped: overlaps a
      at('c', 104, 214),   // overlaps b, but NOT a -- must still be labelled
    ])
    expect(kept).toEqual(['a', 'c'])
  })

  it('is decided by the order it is given, so the caller owns which name survives', () => {
    const pair = [at('a', 100, 200), at('b', 104, 204)]
    expect(unclutteredLabels(pair)).toEqual(['a'])
    expect(unclutteredLabels([...pair].reverse())).toEqual(['b'])
  })

  it('keeps a node whose label is empty out of the way entirely', () => {
    // No text means nothing is drawn, so it neither takes a slot nor blocks one.
    expect(unclutteredLabels([{ id: 'a', x: 100, y: 200, label: '' }, at('b', 104, 204)]))
      .toEqual(['b'])
  })

  // LABEL_CHAR_PX decides every overlap a DOM-less caller judges, and nothing
  // above could tell 6.2 from 7.4 -- both values leave this file green, which
  // is the state it shipped in. This fixture is clear at one and colliding at
  // the other.
  it('pins the fallback advance, since it is what decides a borderline pair', () => {
    // 'ON8AR' is 5 characters and a box starts at x + 18 (the glyph plus the
    // label's margin). So `a` spans 18 .. 18 + 5 x charPx, and `b` starts at
    // 50. At 6.2 px/char `a` ends at 49 and the two clear each other by 1 px;
    // at 7.4 it ends at 55 and they overlap by 5.
    const pair = [at('a', 0, 0, 'ON8AR'), at('b', 32, 0, 'ON8AR')]
    expect(unclutteredLabels(pair)).toEqual(['a', 'b'])
    expect(unclutteredLabels(pair, { charPx: 7.4 })).toEqual(['a'])
  })

  it('survives an empty or missing list', () => {
    expect(unclutteredLabels([])).toEqual([])
    expect(unclutteredLabels(undefined)).toEqual([])
  })
})

// A stand-in for the map container. There is no jsdom here (see
// placePopover.test.js), and the module only ever asks a host for
// ownerDocument.createElement and appendChild -- so the seam is small enough to
// fake, and faking it is what lets the cache be counted. The widths are the
// ones measured in a browser against the real .np-label.
const REAL_PX = { 'NL-DR-GTN-OBS01': 100.05, 'ON8AR': 37.09, 'nl-dr-gtn-rp02': 69.3 }
function fakeHost(widths = REAL_PX) {
  const reads = []
  const probe = {
    className: '',
    textContent: '',
    getBoundingClientRect() {
      reads.push(this.textContent)
      return { width: widths[this.textContent] ?? 0 }
    },
  }
  const host = {
    appended: [],
    ownerDocument: { createElement: () => probe },
    appendChild(el) { this.appended.push(el) },
  }
  return { host, probe, reads }
}

describe('createLabelMeasurer', () => {
  it('reports what the browser draws, not a per-character estimate', () => {
    const { host } = fakeHost()
    const measure = createLabelMeasurer(host)
    // The estimate calls this name 93.0 px (15 x 6.2) and it is really 100.1.
    // Under-measuring is the direction that permits an overlap, and uppercase
    // names -- the ones MeshCore repeaters use -- are where it happens.
    expect(measure('NL-DR-GTN-OBS01')).toBe(100.05)
    expect(labelBox(at('a', 0, 0, 'NL-DR-GTN-OBS01'), { measure }).width).toBe(100.05)
  })

  it('measures each distinct name once, however often it is asked', () => {
    // The whole reason this can replace the estimate: a width does not change
    // with the zoom, so a pan or a redraw re-reads nothing.
    const { host, reads } = fakeHost()
    const measure = createLabelMeasurer(host)
    measure('ON8AR'); measure('ON8AR'); measure('ON8AR')
    expect(reads).toEqual(['ON8AR'])
    measure('nl-dr-gtn-rp02'); measure('ON8AR')
    expect(reads).toEqual(['ON8AR', 'nl-dr-gtn-rp02'])
  })

  it('costs nothing for a name that is not drawn', () => {
    const { host, reads } = fakeHost()
    const measure = createLabelMeasurer(host)
    expect(measure('')).toBe(0)
    expect(measure(null)).toBe(0)
    expect(reads).toEqual([])
  })

  it('puts the probe inside the host given, and not among the drawn labels', () => {
    // Inside the host, because the font is inherited and the labels live in the
    // map container. NOT wearing .np-label, because a probe that answered a
    // `.np-label` query would be counted as a name on screen -- the e2e reads
    // that class to count what was decluttered.
    const { host, probe } = fakeHost()
    createLabelMeasurer(host)
    expect(host.appended).toEqual([probe])
    expect(probe.className.split(' ')).toContain('np-label-probe')
    expect(probe.className.split(' ')).not.toContain('np-label')
  })

  it('returns null where there is no DOM, so the caller falls back', () => {
    expect(createLabelMeasurer(null)).toBe(null)
    expect(createLabelMeasurer({})).toBe(null)
  })
})

// #639: the planner knew nothing of the screen. A label running past the edge
// was kept and clipped, and one under the FAB rail kept and covered. `bounds`
// is the rectangle the labels are drawn into, and `obstacles` the overlays
// over it whose place the caller knows; a label that does not fit is dropped
// the way a colliding one is, and the name stays in the popup.
describe('unclutteredLabels keeps names on the screen and clear of the overlays (#639)', () => {
  const measure = () => 50
  const at = (id, x, y) => ({ id, x, y, label: 'NAME' })
  it('drops a label that would run past an edge of the bounds', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
    // Label box: x + 18 .. x + 68, y - 6.5 .. y + 6.5.
    expect(unclutteredLabels([at('in', 100, 100), at('right', 340, 100), at('top', 100, 4), at('bottom', 100, 296)], { measure, bounds }))
      .toEqual(['in'])
  })
  it('drops a label under an obstacle, and keeps one beside it', () => {
    const obstacles = [{ left: 340, top: 200, width: 46, height: 46 }]
    expect(unclutteredLabels([at('under', 300, 220), at('above', 300, 150)], { measure, obstacles }))
      .toEqual(['above'])
  })
  it('does not let an obstacle or the edge block anything else once its label is dropped', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
    expect(unclutteredLabels([at('off', 380, 100), at('next', 100, 100)], { measure, bounds })).toEqual(['next'])
  })
  it('is unchanged for a caller that gives neither', () => {
    expect(unclutteredLabels([at('a', 380, 100), at('b', -50, -50)], { measure })).toEqual(['a', 'b'])
  })
})

describe('screenObstacles (#639)', () => {
  const el = (r, hidden = false) => ({ hidden, getBoundingClientRect: () => r })
  const host = el({ left: 10, top: 48, width: 800, height: 600 })
  it('puts each overlay in the map container\'s coordinates', () => {
    expect(screenObstacles(host, [el({ left: 760, top: 400, width: 46, height: 46 })]))
      .toEqual([{ left: 750, top: 352, width: 46, height: 46 }])
  })
  it('leaves out an overlay that is hidden or has no box', () => {
    expect(screenObstacles(host, [el({ left: 0, top: 0, width: 40, height: 40 }, true), el({ left: 0, top: 0, width: 0, height: 0 }), null])).toEqual([])
  })
  it('is empty without a host', () => {
    expect(screenObstacles(null, [el({ left: 0, top: 0, width: 4, height: 4 })])).toEqual([])
  })
})
