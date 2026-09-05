import { describe, it, expect } from 'vitest'
import { compassHeading, bearingForHeading, nextCompassState, compassGlyph, compassRingIndex, COMPASS_RING_STOPS, resolveCourseHeading, COURSE_MIN_SPEED_MS, COURSE_RELEASE_SPEED_MS, autoSource, orientedToTravel, lookAheadPadding } from '../rotation.js'

describe('compassHeading', () => {
  it('prefers iOS webkitCompassHeading when present', () => {
    expect(compassHeading({ webkitCompassHeading: 42, alpha: 300, absolute: true })).toBe(42)
  })
  it('derives heading from absolute alpha (Android): heading = 360 - alpha', () => {
    expect(compassHeading({ alpha: 90, absolute: true })).toBe(270)
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0)
    expect(compassHeading({ alpha: 360, absolute: true })).toBe(0)
  })
  it('returns null for non-absolute alpha (arbitrary zero point, unusable as compass)', () => {
    expect(compassHeading({ alpha: 90, absolute: false })).toBe(null)
  })
  it('returns null when there is no usable reading', () => {
    expect(compassHeading({ alpha: null, absolute: true })).toBe(null)
    expect(compassHeading({})).toBe(null)
  })
})

describe('bearingForHeading', () => {
  it('rotates the map opposite to the heading so the heading points up', () => {
    expect(bearingForHeading(0)).toBe(0)
    expect(bearingForHeading(90)).toBe(-90)
    expect(bearingForHeading(270)).toBe(-270)
  })
  it('normalizes headings outside 0..360', () => {
    expect(bearingForHeading(450)).toBe(-90)
    expect(bearingForHeading(-90)).toBe(-270)
  })
  it('guards non-finite headings to north-up instead of a NaN bearing', () => {
    // GeolocationCoordinates.heading is NaN when stationary per the W3C spec
    // (iOS Safari follows it) — a NaN bearing would corrupt the map transform.
    expect(bearingForHeading(NaN)).toBe(0)
    expect(bearingForHeading(Infinity)).toBe(0)
  })
})

describe('nextCompassState', () => {
  // The cycle since #403: static -> follow (north up) -> follow + heading
  // (device compass, GPS course by itself once driving) -> static. Driving
  // is no longer a stop of its own, and the button releases follow, where it
  // used to take a pan.
  it('static taps to following, north up', () => {
    expect(nextCompassState({ follow: false, source: null })).toEqual({ follow: true, source: null })
    expect(nextCompassState({ follow: false, source: 'device' })).toEqual({ follow: true, source: null })
  })
  it('following (north up) taps to heading mode', () => {
    expect(nextCompassState({ follow: true, source: null })).toEqual({ follow: true, source: 'device' })
  })
  it('heading mode taps to static, whichever sensor is driving it', () => {
    expect(nextCompassState({ follow: true, source: 'device' })).toEqual({ follow: false, source: null })
    expect(nextCompassState({ follow: true, source: 'course' })).toEqual({ follow: false, source: null })
  })
})

describe('compassGlyph', () => {
  it('maps each compass state to its glyph', () => {
    expect(compassGlyph({ follow: false, source: null })).toBe('static')
    expect(compassGlyph({ follow: true, source: null })).toBe('following')
    expect(compassGlyph({ follow: true, source: 'device' })).toBe('heading')
    expect(compassGlyph({ follow: true, source: 'course' })).toBe('driving')
  })
  it('the previewed (next-state) glyph is what a tap produces', () => {
    expect(compassGlyph(nextCompassState({ follow: false, source: null }))).toBe('following')
    expect(compassGlyph(nextCompassState({ follow: true, source: null }))).toBe('heading')
    expect(compassGlyph(nextCompassState({ follow: true, source: 'device' }))).toBe('static')
    expect(compassGlyph(nextCompassState({ follow: true, source: 'course' }))).toBe('static')
  })
  // Heading and driving are one stop of the cycle; the ring says which stop,
  // not which sensor. Static is the off state, outside the ring.
  it('puts heading and driving on the same ring segment', () => {
    expect(compassRingIndex({ follow: true, source: null })).toBe(0)
    expect(compassRingIndex({ follow: true, source: 'device' })).toBe(1)
    expect(compassRingIndex({ follow: true, source: 'course' })).toBe(1)
    expect(compassRingIndex({ follow: false, source: null })).toBe(-1)
    expect(COMPASS_RING_STOPS).toBe(2)
  })
})

// #403: in heading mode the sensor follows the speed. Above the driving
// threshold the GPS course is the steadier reading; back below a release
// speed the compass takes over again, so a crawl at the threshold does not
// swap sensors at every fix. A correction (a two-finger rotate) clears the
// source, and this only ever acts on a live one, so after a correction
// nothing switches until the mode is cycled back.
describe('autoSource', () => {
  it('engages the GPS course at the driving threshold', () => {
    expect(autoSource('device', COURSE_MIN_SPEED_MS)).toBe('course')
    expect(autoSource('device', COURSE_MIN_SPEED_MS - 0.1)).toBe('device')
  })
  it('returns to the compass only below the release speed', () => {
    expect(COURSE_RELEASE_SPEED_MS).toBeLessThan(COURSE_MIN_SPEED_MS)
    expect(autoSource('course', COURSE_RELEASE_SPEED_MS)).toBe('course')
    expect(autoSource('course', COURSE_RELEASE_SPEED_MS - 0.1)).toBe('device')
    expect(autoSource('course', (COURSE_MIN_SPEED_MS + COURSE_RELEASE_SPEED_MS) / 2)).toBe('course')
  })
  it('holds the sensor while the speed is unknown', () => {
    expect(autoSource('device', null)).toBe('device')
    expect(autoSource('course', NaN)).toBe('course')
  })
  it('never arms a cleared source', () => {
    expect(autoSource(null, 30)).toBeNull()
  })
})

// #403: the position sits low in the frame while the map is oriented to
// travel, so the half that can say where the signal is going gets the room.
// Centred otherwise: north-up "ahead" is not a direction.
describe('look-ahead', () => {
  it('is on only while following with a rotation source', () => {
    expect(orientedToTravel({ follow: true, source: 'device' })).toBe(true)
    expect(orientedToTravel({ follow: true, source: 'course' })).toBe(true)
    expect(orientedToTravel({ follow: true, source: null })).toBe(false)
    expect(orientedToTravel({ follow: false, source: 'device' })).toBe(false)
  })
  it('pads the top by a third of the viewport, which puts the centre two thirds down', () => {
    expect(lookAheadPadding(780, true)).toEqual({ top: 260, bottom: 0, left: 0, right: 0 })
    expect(lookAheadPadding(780, false)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
    // The centre of the un-padded area: (260 + 780) / 2 = 520 = 2/3 of 780.
    expect((lookAheadPadding(780, true).top + 780) / 2 / 780).toBeCloseTo(2 / 3, 5)
  })
})

describe('resolveCourseHeading', () => {
  // GPS course is null when stationary/low-speed on most devices (#242).
  // Hold the last known heading instead of snapping to north-up every time
  // the hunter stops at a light.
  it('uses the fresh heading when the fix has one', () => {
    expect(resolveCourseHeading(90, 45)).toBe(90)
  })
  it('holds the last known heading when the fix has none', () => {
    expect(resolveCourseHeading(null, 45)).toBe(45)
  })
  it('stays null when neither the fix nor the last known heading exist yet', () => {
    expect(resolveCourseHeading(null, null)).toBe(null)
  })
  it('holds the last known heading on a NaN heading (W3C: stationary devices report NaN, not null)', () => {
    // The exact "stopped at a light" path this feature targets on iOS Safari.
    expect(resolveCourseHeading(NaN, 45)).toBe(45)
    expect(resolveCourseHeading(NaN, null)).toBe(null)
  })
  it('ignores the reported heading below the minimum speed (low-speed course jitter)', () => {
    // Some devices keep reporting a noisy non-null heading while crawling —
    // gate on speed so the map does not swing to low-speed course noise.
    expect(resolveCourseHeading(90, 45, 1)).toBe(45)
    expect(resolveCourseHeading(90, 45, 0)).toBe(45)
    expect(resolveCourseHeading(90, null, 1)).toBe(null)
  })
  it('uses the fresh heading at or above the minimum speed', () => {
    expect(resolveCourseHeading(90, 45, COURSE_MIN_SPEED_MS)).toBe(90)
    expect(resolveCourseHeading(90, 45, 13.9)).toBe(90)
  })
  it('falls back to heading availability when speed is unavailable (null/NaN per spec)', () => {
    expect(resolveCourseHeading(90, 45, null)).toBe(90)
    expect(resolveCourseHeading(90, 45, NaN)).toBe(90)
    expect(resolveCourseHeading(90, 45, undefined)).toBe(90)
  })
})
