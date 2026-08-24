import { describe, it, expect } from 'vitest'
import { octagonRing, pillarRadiusM, collapsePillars, PILLAR_MERGE_M , cellKey, recordsSignature, createPillarCollapser } from '../pointmarker.js'

describe('octagonRing', () => {
  it('returns a closed ring of 9 points (octagon)', () => {
    const ring = octagonRing(51.0, 3.7, 3)
    expect(ring).toHaveLength(9)
    expect(ring[0]).toEqual(ring[8])
  })
  it('centers the ring on the given lat/lon', () => {
    const ring = octagonRing(51.0, 3.7, 3)
    const pts = ring.slice(0, 8)
    const avgLon = pts.reduce((s, [lo]) => s + lo, 0) / pts.length
    const avgLat = pts.reduce((s, [, la]) => s + la, 0) / pts.length
    expect(avgLon).toBeCloseTo(3.7, 6)
    expect(avgLat).toBeCloseTo(51.0, 6)
  })
  it('grows with radiusM', () => {
    const span = (ring) => Math.max(...ring.map(([lo]) => lo)) - Math.min(...ring.map(([lo]) => lo))
    const small = octagonRing(51.0, 3.7, 1)
    const large = octagonRing(51.0, 3.7, 10)
    expect(span(large)).toBeGreaterThan(span(small))
  })
  it('widens the longitude span at higher latitude (cos(lat) correction)', () => {
    // Same radiusM, same ground distance — but a degree of longitude covers
    // less ground near the poles, so the ring's longitude span must be wider.
    const lonSpan = (ring) => Math.max(...ring.map(([lo]) => lo)) - Math.min(...ring.map(([lo]) => lo))
    const equator = octagonRing(0, 0, 5)
    const highLat = octagonRing(70, 0, 5)
    expect(lonSpan(highLat)).toBeGreaterThan(lonSpan(equator))
  })
  it('keeps the latitude span independent of latitude (no distortion N/S)', () => {
    const latSpan = (ring) => Math.max(...ring.map(([, la]) => la)) - Math.min(...ring.map(([, la]) => la))
    const equator = octagonRing(0, 0, 5)
    const highLat = octagonRing(70, 0, 5)
    expect(latSpan(highLat)).toBeCloseTo(latSpan(equator), 9)
  })
})

describe('pillarRadiusM', () => {
  // At hunting zooms the true 3 m footprint is already several pixels, so it is
  // left alone; zoomed out it would be a hairline, so the pixel floor takes over.
  it('keeps the true metre size where it is already legible', () => {
    expect(pillarRadiusM(51, 18, 3, 4)).toBe(3)
  })

  it('widens once the true size would fall below the pixel floor', () => {
    const w = pillarRadiusM(51, 14, 3, 4)
    expect(w).toBeGreaterThan(3)
    // 4 px at z14/lat51 is on the order of ten metres, not hundreds.
    expect(w).toBeLessThan(50)
  })

  it('never shrinks below the base size, however far in you zoom', () => {
    for (const z of [16, 18, 20, 22]) expect(pillarRadiusM(51, z, 3, 4)).toBeGreaterThanOrEqual(3)
  })

  it('grows monotonically as you zoom out', () => {
    const widths = [18, 16, 14, 12, 10].map((z) => pillarRadiusM(51, z, 3, 4))
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1])
  })
})

// The gap that let the apothem→circumradius change pass silently: the suite
// pinned closure, ordering, cos(lat) widening and the zoom floor, but nothing
// pinned the ring's absolute ground size — so a helper returning a different
// KIND of length for the same argument broke nothing.
describe('octagonRing size is a circumradius, deliberately (#308)', () => {
  const M_PER_DEG_LAT = (2 * Math.PI * 6378137) / 360
  const distM = (lat, lon, [lon2, lat2]) => {
    const dy = (lat2 - lat) * M_PER_DEG_LAT
    const dx = (lon2 - lon) * M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180)
    return Math.hypot(dx, dy)
  }

  it('puts every vertex at exactly radiusM from the centre', () => {
    const ring = octagonRing(51, 4, 10)
    for (const p of ring) expect(distM(51, 4, p)).toBeCloseTo(10, 6)
  })

  it('is regular — all eight vertices equidistant, not just the axis-aligned ones', () => {
    const ring = octagonRing(51, 4, 10).slice(0, 8)
    const ds = ring.map((p) => distM(51, 4, p))
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(1e-6)
  })

  // The accepted trade: across the flats the octagon is cos(pi/8) of the
  // square that preceded it for the same argument, i.e. 7.4px where the old
  // square gave 8px at the 4px floor. Pinned so the choice stays deliberate
  // rather than being rediscovered as a bug.
  it('measures 2*r*cos(pi/8) across the flats, not 2*r', () => {
    const r = 10
    const ring = octagonRing(51, 4, r)
    const apothem = distM(51, 4, ring[0]) * Math.cos(Math.PI / 8)
    expect(apothem).toBeCloseTo(r * 0.92387953, 6)
    expect(2 * apothem).toBeCloseTo(18.4775906, 5)
  })

  it('scales linearly with radiusM', () => {
    expect(distM(51, 4, octagonRing(51, 4, 20)[0])).toBeCloseTo(2 * distM(51, 4, octagonRing(51, 4, 10)[0]), 6)
  })
})

// Collapsing coincident pillars (#402). A stationary or slow-moving hunter logs
// many receptions within metres of each other; each became its own octagon at
// the same place, and coplanar side walls in one depth pass z-fight — observed
// as a column striped red/teal along its whole height, the stripes shifting
// with the camera. The fix has to hold for GPS jitter, which is metres, not
// zero.
describe('collapsePillars', () => {
  const rec = (id, lat, lon, rssi) => ({ id, lat, lon, rssi, rx_at: 1000 + id })

  it('collapses exactly coincident receptions to one', () => {
    const out = collapsePillars([rec(1, 52.0, 4.0, -100), rec(2, 52.0, 4.0, -60)])
    expect(out).toHaveLength(1)
  })
  it('keeps the strongest sample, whatever order it arrives in', () => {
    const weakFirst = collapsePillars([rec(1, 52.0, 4.0, -100), rec(2, 52.0, 4.0, -60)])
    const strongFirst = collapsePillars([rec(2, 52.0, 4.0, -60), rec(1, 52.0, 4.0, -100)])
    expect(weakFirst[0].id).toBe(2)
    expect(strongFirst[0].id).toBe(2)
  })
  it('hands back the record itself, so the tap still resolves to a log row', () => {
    const [survivor] = collapsePillars([rec(7, 52.0, 4.0, -70)])
    expect(survivor).toEqual(rec(7, 52.0, 4.0, -70))
  })
  it('draws the survivor where it was heard, not at a cell centre', () => {
    // Two records, so the collapse actually runs — a single one short-circuits
    // and would pass no matter what the survivor's coordinates were rewritten to.
    const [survivor, ...rest] = collapsePillars([
      rec(1, 52.000031, 4.000047, -70),
      rec(2, 52.000035, 4.000051, -90),
    ])
    expect(rest).toEqual([])
    expect(survivor.lat).toBe(52.000031)
    expect(survivor.lon).toBe(4.000047)
  })
  it('collapses receptions a few metres apart — GPS jitter, not a second position', () => {
    const out = collapsePillars([rec(1, 52.0, 4.0, -70), rec(2, 52.0 + 3 / 111320, 4.0, -80)])
    expect(out).toHaveLength(1)
  })
  it('keeps positions further apart than the merge distance', () => {
    const out = collapsePillars([rec(1, 52.0, 4.0, -70), rec(2, 52.0 + 50 / 111320, 4.0, -80)])
    expect(out).toHaveLength(2)
  })
  // The case plain grid binning gets wrong: two samples 1 m apart still land in
  // different cells when they straddle a boundary, and two pillars 1 m apart
  // with a 3 m radius overlap — which is the whole defect, unfixed.
  it('collapses across a cell boundary, where a bare grid would not', () => {
    const M_PER_DEG_LAT = 111320
    const half = (Math.round(52 * M_PER_DEG_LAT / PILLAR_MERGE_M) + 0.5) * PILLAR_MERGE_M / M_PER_DEG_LAT
    const out = collapsePillars([
      rec(1, half - 0.5 / M_PER_DEG_LAT, 4.0, -70),
      rec(2, half + 0.5 / M_PER_DEG_LAT, 4.0, -80),
    ])
    expect(out).toHaveLength(1)
  })
  // One 10 m cell is 14 m across the diagonal, so two records can share a cell
  // and still be further apart than the merge distance. Keying survivors by
  // cell alone loses one of them.
  it('keeps both when one cell holds two positions further apart than the merge distance', () => {
    // Built in cell units so both records provably land in the SAME cell:
    // opposite corners at 0.4 of a cell from its centre, 11.3 m apart. 0.4 and
    // not 0.49 — the module scales longitude by cos(lat) of the first record,
    // which shifts a position by ~0.03 of a cell against the round number used
    // here, enough to push a 0.49 corner into the next cell.
    const M_PER_DEG_LAT = 111320
    const M_PER_DEG_LON = 111320 * Math.cos((52 * Math.PI) / 180)
    const cx = Math.round(4 * M_PER_DEG_LON / PILLAR_MERGE_M)
    const cy = Math.round(52 * M_PER_DEG_LAT / PILLAR_MERGE_M)
    const at = (fx, fy) => [(cy + fy) * PILLAR_MERGE_M / M_PER_DEG_LAT, (cx + fx) * PILLAR_MERGE_M / M_PER_DEG_LON]
    const [latA, lonA] = at(0.4, 0.4)
    const [latB, lonB] = at(-0.4, -0.4)
    const out = collapsePillars([rec(1, latA, lonA, -70), rec(2, latB, lonB, -80)])
    expect(out.map((r) => r.id).sort()).toEqual([1, 2])
  })
  it('drops records with no position, which cannot be drawn at all', () => {
    const out = collapsePillars([rec(1, null, null, -70), rec(2, 52.0, 4.0, -80)])
    expect(out.map((r) => r.id)).toEqual([2])
  })
  it('treats a missing rssi as weakest rather than dropping the record', () => {
    expect(collapsePillars([{ id: 1, lat: 52.0, lon: 4.0 }])).toHaveLength(1)
    const out = collapsePillars([{ id: 1, lat: 52.0, lon: 4.0 }, rec(2, 52.0, 4.0, -110)])
    expect(out[0].id).toBe(2)
  })
  it('returns nothing for no input', () => {
    expect(collapsePillars([])).toEqual([])
  })
})

// #462: the 3x3 neighbourhood scan built nine string keys per record, ~1.2M
// allocations at the sizes a no-time-filter tick reaches. A numeric key is only
// collision-free while |cy| stays well under the multiplier, and that invariant
// is exactly the kind that should not be implicit.
describe('cellKey', () => {
  // The load-bearing property, stated as one: stepping cx by one has to jump
  // further than the entire range cy can occupy, or some (cx, cy) pair folds
  // onto another. A sampled grid does NOT catch this -- the first version of
  // this test survived a multiplier of 2^10, because the sample was too sparse
  // to contain a colliding pair.
  const CY_MAX = Math.round(90 * 111320 / PILLAR_MERGE_M)   // |cy| at the poles
  const CX_MAX = Math.round(180 * 111320 / PILLAR_MERGE_M)  // |cx| at the equator

  it('steps cx further than cy can ever reach', () => {
    expect(cellKey(1, 0) - cellKey(0, 0)).toBeGreaterThan(2 * CY_MAX)
  })

  it('collides for no pair in a dense strip at the worst-case latitude', () => {
    const seen = new Set()
    for (let cx = -2; cx <= 2; cx++) {
      for (let cy = CY_MAX - 3; cy <= CY_MAX; cy++) {
        const k = cellKey(cx, cy)
        expect(seen.has(k)).toBe(false)
        seen.add(k)
        const mirrored = cellKey(cx, -cy)
        expect(seen.has(mirrored)).toBe(false)
        seen.add(mirrored)
      }
    }
  })

  it('separates neighbours that a too-small multiplier would fold together', () => {
    expect(cellKey(1, 0)).not.toBe(cellKey(0, 1))
    expect(cellKey(1, -1)).not.toBe(cellKey(0, 1))
    expect(cellKey(-1, 1)).not.toBe(cellKey(0, -1))
  })

  it('stays inside the safe integer range at the extremes', () => {
    expect(Number.isSafeInteger(cellKey(CX_MAX, CY_MAX))).toBe(true)
    expect(Number.isSafeInteger(cellKey(-CX_MAX, -CY_MAX))).toBe(true)
  })
})

// The deeper waste #462 measured: a static store collapses the same rows sixty
// times a minute for an identical answer. The collapse depends only on the
// records -- not on zoom, age-fade or the plot offset -- so it can be skipped
// wholesale when nothing new has landed.
describe('createPillarCollapser', () => {
  const rec = (id, lat, lon, rssi) => ({ id, lat, lon, rssi, rx_at: 1000 + id })
  const rows = [rec(1, 52.0, 4.0, -70), rec(2, 52.001, 4.001, -80)]

  it('does not recompute for a set that has not changed', () => {
    const collapse = createPillarCollapser()
    const first = collapse(rows)
    // A fresh array with the same rows: the tick hands over a new array every
    // second, so identity of the input cannot be what decides this.
    expect(collapse([...rows])).toBe(first)
  })

  it('recomputes when a record lands', () => {
    const collapse = createPillarCollapser()
    const first = collapse(rows)
    const grown = collapse([...rows, rec(3, 53.0, 5.0, -60)])
    expect(grown).not.toBe(first)
    expect(grown.map((r) => r.id).sort()).toEqual([1, 2, 3])
  })

  it('recomputes when the set is swapped for a different one of the same size', () => {
    const collapse = createPillarCollapser()
    const first = collapse(rows)
    expect(collapse([rec(7, 52.0, 4.0, -70), rec(8, 52.001, 4.001, -80)])).not.toBe(first)
  })

  it('never memoises a set it cannot sign, rather than returning a stale answer', () => {
    const collapse = createPillarCollapser()
    const unsigned = [{ lat: 52.0, lon: 4.0, rssi: -70 }]
    expect(collapse(unsigned)).not.toBe(collapse(unsigned))
    expect(recordsSignature(unsigned)).toBeNull()
  })
})

