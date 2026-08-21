import { describe, it, expect } from 'vitest'
import { labelBox, unclutteredLabels, LABEL_CHAR_PX, LABEL_HEIGHT_PX, LABEL_OFFSET_PX } from './nodelabels.js'

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

  it('survives an empty or missing list', () => {
    expect(unclutteredLabels([])).toEqual([])
    expect(unclutteredLabels(undefined)).toEqual([])
  })
})
