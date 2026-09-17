import { describe, it, expect } from 'vitest'
import { noticesPlacement, NOTICE_GAP } from './noticeplace.js'

// #630: the map notices sit at the top centre, and the receptions ticker starts
// in the top left. At 1280 the two overlapped, and the notice (z 625 over the
// ticker's 620) took the clicks meant for the ticker's own controls.
describe('noticesPlacement', () => {
  const VW = 1280
  const TOP = 72          // the bar's lower edge plus the notices' 8px
  const RAIL_LEFT = 1220  // 1280 - 14 - 46
  const TICKER = { left: 12, right: 692, top: 64, bottom: 102 }   // a first visit, empty
  // The column as the stylesheet centres it, measured by map.js.
  const column = (vw, width = 560) => ({ left: (vw - width) / 2, width, top: TOP, height: 51 })
  const at = (over) => noticesPlacement({ vw: VW, column: column(VW), railLeft: RAIL_LEFT, ticker: TICKER, ...over })

  it('centres a 560px column when the ticker is away', () => {
    expect(at({ ticker: null })).toEqual({ left: 360, width: 560, top: TOP })
  })

  it('stays centred when the ticker is somewhere the column does not reach', () => {
    // Dragged to the bottom left: under the column's left edge, but far below it.
    expect(at({ ticker: { left: 12, right: 692, top: 600, bottom: 780 } })).toEqual({ left: 360, width: 560, top: TOP })
    // Dragged into the top right beside it.
    expect(at({ ticker: { left: 930, right: 1210, top: 64, bottom: 102 } })).toEqual({ left: 360, width: 560, top: TOP })
  })

  // "Between the ticker and the rail", as the issue puts it: the free band
  // right of the ticker, still under the bar, when it holds a readable column.
  it('moves into the band between the ticker and the rail when that holds the column', () => {
    const band = { left: 692 + NOTICE_GAP, right: RAIL_LEFT - NOTICE_GAP }
    const p = at()
    expect(p.top).toBe(TOP)
    expect(p.left).toBe(band.left)
    expect(p.left + p.width).toBe(band.right)
  })

  it('centres a 560px column in a band wider than that', () => {
    const p = at({ vw: 1920, column: column(1920), railLeft: 1860 })
    const bandLeft = 692 + NOTICE_GAP, bandRight = 1860 - NOTICE_GAP
    expect(p.width).toBe(560)
    expect(p.left - bandLeft).toBe(bandRight - (p.left + p.width))
    expect(p.top).toBe(TOP)
  })

  it('uses the band left of a ticker that was dragged to the right', () => {
    const p = at({ vw: 1920, column: column(1920), railLeft: 1860, ticker: { left: 1100, right: 1780, top: 64, bottom: 102 } })
    expect(p.left).toBeGreaterThanOrEqual(NOTICE_GAP)
    expect(p.left + p.width).toBeLessThanOrEqual(1100 - NOTICE_GAP)
    expect(p.top).toBe(TOP)
  })

  // At 1024 the band is 250px: a column of three words a line. Under the whole
  // card instead, rows included, since the rows take clicks too.
  it('drops under the ticker when the band beside it is too narrow to read', () => {
    const tall = { left: 12, right: 692, top: 64, bottom: 362 }
    expect(at({ vw: 1024, column: column(1024), railLeft: 964, ticker: tall })).toEqual({ left: 232, width: 560, top: 362 + NOTICE_GAP })
  })

  // Below 640px the ticker is pinned across the width (#643), so there is never
  // a band: the notices go under it.
  it('drops under a ticker pinned across a phone', () => {
    const pinned = { left: 10, right: 365, top: 60, bottom: 122 }
    const full = { left: 8, width: 359, top: TOP, height: 68 }
    expect(at({ vw: 375, column: full, railLeft: 315, ticker: pinned })).toEqual({ left: 8, width: 359, top: 122 + NOTICE_GAP })
  })

  // The stylesheet narrows the centred column so it clears the rail's column
  // (at 667x375 a 560px column reached 7px into it), and on a phone held
  // sideways it runs from the left gutter to the rail, off centre. The column
  // it measured is the one kept, not a 560px one worked out again here.
  it('keeps the column the stylesheet laid out, which clears the rail', () => {
    const sideways = { left: 8, width: 492, top: TOP, height: 51 }
    expect(at({ vw: 568, column: sideways, railLeft: 517, ticker: null })).toEqual({ left: 8, width: 492, top: TOP })
    const pinned = { left: 10, right: 500, top: 52, bottom: 116 }
    expect(at({ vw: 568, column: sideways, railLeft: 517, ticker: pinned })).toEqual({ left: 8, width: 492, top: 116 + NOTICE_GAP })
  })
})
