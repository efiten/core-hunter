import { describe, it, expect } from 'vitest'
import { octagonRing, pillarRadiusM } from '../pointmarker.js'

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
