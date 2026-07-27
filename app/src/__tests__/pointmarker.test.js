import { describe, it, expect } from 'vitest'
import { squareRing, pillarHalfWidthM } from '../pointmarker.js'

describe('squareRing', () => {
  it('returns a closed ring of 5 points', () => {
    const ring = squareRing(51.0, 3.7, 3)
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })
  it('centers the ring on the given lat/lon', () => {
    const ring = squareRing(51.0, 3.7, 3)
    const avgLon = ring.slice(0, 4).reduce((s, [lo]) => s + lo, 0) / 4
    const avgLat = ring.slice(0, 4).reduce((s, [, la]) => s + la, 0) / 4
    expect(avgLon).toBeCloseTo(3.7, 6)
    expect(avgLat).toBeCloseTo(51.0, 6)
  })
  it('grows with halfWidthM', () => {
    const small = squareRing(51.0, 3.7, 1)
    const large = squareRing(51.0, 3.7, 10)
    const width = (ring) => ring[1][0] - ring[0][0]
    expect(width(large)).toBeGreaterThan(width(small))
  })
  it('widens the longitude delta at higher latitude (cos(lat) correction)', () => {
    // Same halfWidthM, same ground distance — but a degree of longitude covers
    // less ground near the poles, so the ring's longitude span must be wider.
    const equator = squareRing(0, 0, 5)
    const highLat = squareRing(70, 0, 5)
    const lonSpan = (ring) => ring[1][0] - ring[0][0]
    expect(lonSpan(highLat)).toBeGreaterThan(lonSpan(equator))
  })
  it('keeps the latitude span independent of latitude (no distortion N/S)', () => {
    const equator = squareRing(0, 0, 5)
    const highLat = squareRing(70, 0, 5)
    const latSpan = (ring) => ring[2][1] - ring[1][1]
    expect(latSpan(highLat)).toBeCloseTo(latSpan(equator), 9)
  })
})

describe('pillarHalfWidthM', () => {
  // At hunting zooms the true 3 m footprint is already several pixels, so it is
  // left alone; zoomed out it would be a hairline, so the pixel floor takes over.
  it('keeps the true metre size where it is already legible', () => {
    expect(pillarHalfWidthM(51, 18, 3, 4)).toBe(3)
  })

  it('widens once the true size would fall below the pixel floor', () => {
    const w = pillarHalfWidthM(51, 14, 3, 4)
    expect(w).toBeGreaterThan(3)
    // 4 px at z14/lat51 is on the order of ten metres, not hundreds.
    expect(w).toBeLessThan(50)
  })

  it('never shrinks below the base size, however far in you zoom', () => {
    for (const z of [16, 18, 20, 22]) expect(pillarHalfWidthM(51, z, 3, 4)).toBeGreaterThanOrEqual(3)
  })

  it('grows monotonically as you zoom out', () => {
    const widths = [18, 16, 14, 12, 10].map((z) => pillarHalfWidthM(51, z, 3, 4))
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1])
  })
})
