import { describe, it, expect } from 'vitest'
import { clampToViewport, topRight, initialPlacement, serialise, parse, EDGE_GAP, COLLAPSE_LEVELS } from './tickerplace.js'

const SIZE = { w: 680, h: 200 }
const DESKTOP = { vw: 1280, vh: 800, top: 48 }
const PHONE = { vw: 390, vh: 780, top: 96 }
// The card at its full height: ten lanes of 26px plus the 36px header.
const FULL = { w: 680, h: 296 }
// A phone held sideways. Wider than the 640px breakpoint, so nothing about the
// width says "phone", and only 309px of map under the bar.
const LANDSCAPE = { vw: 844, vh: 390, top: 81 }

describe('clampToViewport', () => {
  it('leaves a box that is already on screen alone', () => {
    expect(clampToViewport({ x: 300, y: 200 }, SIZE, DESKTOP)).toEqual({ x: 300, y: 200 })
  })

  it('pulls a box back from beyond the right and bottom edges', () => {
    // The case the issue's safety net is for: dragged to the edge of a wide
    // screen, reopened on a narrow one.
    expect(clampToViewport({ x: 5000, y: 5000 }, SIZE, DESKTOP)).toEqual({ x: 600, y: 600 })
  })

  it('never puts the ticker under the bar', () => {
    // The bar is opaque, so a row above its lower edge is simply invisible.
    expect(clampToViewport({ x: 10, y: 0 }, SIZE, DESKTOP).y).toBe(48)
    expect(clampToViewport({ x: 10, y: -400 }, SIZE, DESKTOP).y).toBe(48)
  })

  it('keeps the near edge when the box is bigger than the space', () => {
    // A 680px band on a 390px phone. Clamping the far edge last would push x
    // negative and strand the left of the band off-screen, which is the half
    // you read.
    const at = clampToViewport({ x: 100, y: 300 }, SIZE, PHONE)
    expect(at.x).toBe(0)
    expect(at.y).toBe(300)
  })
})

describe('topRight', () => {
  it('sits clear of the right edge and below the bar', () => {
    expect(topRight(SIZE, DESKTOP)).toEqual({ x: 1280 - 680 - EDGE_GAP, y: 48 + EDGE_GAP })
  })
  it('does not go negative on a screen narrower than the ticker', () => {
    expect(topRight(SIZE, PHONE).x).toBe(0)
  })
})

describe('initialPlacement', () => {
  it('starts top-right on a first visit', () => {
    const p = initialPlacement({ size: SIZE, viewport: DESKTOP })
    expect(p).toMatchObject(topRight(SIZE, DESKTOP))
  })

  it('restores a remembered position, clamped to this screen', () => {
    // Saved on a wide monitor, reopened on a phone.
    const p = initialPlacement({ saved: { x: 1100, y: 700, collapse: 0, hidden: false }, size: SIZE, viewport: PHONE })
    expect(p.x).toBe(0)
    expect(p.y).toBe(580)
    expect(p.collapse).toBe(0)
  })

  it('collapses by default on a phone and not on a desktop', () => {
    // A phone starts at the last stop, the header alone, which is what the
    // pre-#424 "collapsed" meant. A desktop starts full.
    // A phone starts at the smallest stop rather than away: the reason the
    // default is per-surface is that the card should not cover the map there,
    // and a ticker nobody can see is a different thing from a small one.
    const phone = initialPlacement({ size: SIZE, viewport: PHONE, narrow: true })
    expect(phone.collapse).toBe(COLLAPSE_LEVELS - 1)
    expect(phone.hidden).toBe(false)
    expect(initialPlacement({ size: SIZE, viewport: DESKTOP, narrow: false }).collapse).toBe(0)
  })

  it('collapses on a short screen too, where the width says nothing', () => {
    // A phone in landscape is 844px wide, so every width test calls it a
    // desktop, and it has 309px of map under the bar. The full card is 296 of
    // those: measured at 844x390, it covered 110% of the visible map, because
    // it also hangs past the bottom edge.
    expect(initialPlacement({ size: FULL, viewport: LANDSCAPE, narrow: false }).collapse)
      .toBe(COLLAPSE_LEVELS - 1)
    // Half the space is the line, so a desktop is untouched: 296 of 752.
    expect(initialPlacement({ size: FULL, viewport: DESKTOP, narrow: false }).collapse).toBe(0)
  })

  it('pulls a remembered position up by the whole card, not by what is rendered', () => {
    // The other half of the same measurement. #rx-log is an empty div when this
    // runs, so a caller passing its measured height clamps against ~2px: a
    // position remembered from a taller window stands, and the card hangs below
    // the fold. Seen in the browser at 844x390 with y=386 -- four pixels of card
    // on screen and 294 under it.
    const p = initialPlacement({ saved: { x: 0, y: 386, collapse: 0 }, size: FULL, viewport: LANDSCAPE })
    expect(p.y).toBe(LANDSCAPE.vh - FULL.h)
  })

  it('lets a remembered choice beat the per-surface default', () => {
    // Someone who collapsed it on a desktop meant it; someone who opened it on
    // a phone meant that too.
    expect(initialPlacement({ saved: { x: 10, y: 100, collapse: 2 }, size: SIZE, viewport: DESKTOP }).collapse).toBe(2)
    expect(initialPlacement({ saved: { x: 10, y: 100, collapse: 0 }, size: SIZE, viewport: PHONE, narrow: true }).collapse).toBe(0)
    expect(initialPlacement({ saved: { x: 10, y: 100, collapse: 0, hidden: true }, size: SIZE, viewport: PHONE, narrow: true }).hidden).toBe(true)
  })

  it('ignores a saved value that is not a position', () => {
    for (const saved of [{ x: null, y: 5 }, { x: NaN, y: 5 }, {}]) {
      expect(initialPlacement({ saved, size: SIZE, viewport: DESKTOP })).toMatchObject(topRight(SIZE, DESKTOP))
    }
  })
})

describe('serialise / parse', () => {
  it('round-trips a placement', () => {
    for (let level = 0; level < COLLAPSE_LEVELS; level++) {
      expect(parse(serialise({ x: 12.4, y: 300.6, collapse: level, hidden: false })), `level ${level}`)
        .toEqual({ x: 12, y: 301, collapse: level, hidden: false })
    }
    expect(parse(serialise({ x: 12.4, y: 300.6, collapse: 2, hidden: true })), 'away')
      .toEqual({ x: 12, y: 301, collapse: 0, hidden: true })
  })

  // Links written before #424 carry 0 or 1 for expanded or folded. Folded meant
  // the header alone, which is now the last stop, so an old link has to land
  // there rather than on the three-lane stop the bare number would hit.
  // '1' was how the ticker was put away before it had a cross, so it has to
  // read as away rather than as a shrink stop.
  it('reads a pre-#424 link, and never writes one back', () => {
    expect(parse('10,20,0')).toEqual({ x: 10, y: 20, collapse: 0, hidden: false })
    expect(parse('10,20,1')).toEqual({ x: 10, y: 20, collapse: 0, hidden: true })
    for (let level = 0; level < COLLAPSE_LEVELS; level++) {
      expect(serialise({ x: 0, y: 0, collapse: level }).split(',')[2], `level ${level}`).not.toBe('1')
    }
    expect(serialise({ x: 0, y: 0, hidden: true }).split(',')[2]).not.toBe('1')
  })

  it('falls back to full for a truncated or hand-edited field', () => {
    for (const v of ['10,20', '10,20,zz', '10,20,9']) {
      expect(parse(v), v).toEqual({ x: 10, y: 20, collapse: 0, hidden: false })
    }
  })
  it('refuses anything it did not write', () => {
    for (const v of ['', 'x,y,1', 'nonsense', null, undefined, 5]) expect(parse(v)).toBe(null)
  })
})
