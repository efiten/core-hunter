// Map-rotation helpers (#116). Pure logic only — the DeviceOrientation
// listener and the leaflet-rotate wiring live in app.js/huntmap.js.

// compassHeading extracts a compass heading (degrees clockwise from north,
// 0..360) from a DeviceOrientationEvent-shaped reading, or null when the
// reading is unusable. iOS exposes webkitCompassHeading directly; elsewhere
// only an *absolute* alpha can serve as a compass (relative alpha has an
// arbitrary zero point).
export function compassHeading(reading) {
  if (!reading) return null
  if (typeof reading.webkitCompassHeading === 'number') return reading.webkitCompassHeading
  if (reading.absolute === true && typeof reading.alpha === 'number') {
    return (360 - reading.alpha) % 360
  }
  return null
}

// bearingForHeading converts a compass heading into the map bearing that puts
// that heading at the top of the screen (rotate the map opposite to the
// heading). Input is normalized to 0..360 first. Non-finite input (the W3C
// Geolocation spec makes heading NaN while stationary) maps to north-up
// instead of poisoning the map transform with a NaN bearing.
export function bearingForHeading(heading) {
  if (!Number.isFinite(heading)) return 0
  const h = ((heading % 360) + 360) % 360
  return h === 0 ? 0 : -h
}

// nextCompassState advances the compass button through its cycle: static ->
// follow (north up) -> follow + heading -> static. `source` is the rotation
// input: null (north up), 'device' (magnetometer), or 'course' (GPS
// course-over-ground, steadier than the magnetometer while actually driving).
// Since #403 the sensor is not a stop of the cycle: heading mode starts on the
// device compass and autoSource hands it to the GPS course once driving, so
// both sources tap to the same place. And the button releases follow, where
// that used to take a pan (Kasper, 2026-09-05: four states on a one-handed
// control was one too many, and a tap that cannot let go was the odd one).
export function nextCompassState({ follow, source }) {
  if (!follow) return { follow: true, source: null }
  if (source == null) return { follow: true, source: 'device' }
  return { follow: false, source: null }
}

// The ring on the FAB shows the stop of the cycle, not the sensor: heading
// and driving share a segment. Static is the off state, outside the ring.
export const COMPASS_RING_STOPS = 2
export function compassRingIndex({ follow, source }) {
  if (!follow) return -1
  return source == null ? 0 : 1
}

// orientedToTravel: is "up" the direction of travel? Only then does a
// look-ahead offset mean anything; north-up "ahead" is not a direction.
export function orientedToTravel({ follow, source }) {
  return !!follow && (source === 'device' || source === 'course')
}

// lookAheadPadding (#403): while the map is oriented to travel the position
// sits two thirds down the frame, so the half that can say where the signal
// is going gets the room, the way Waze and Maps drop the puck during
// navigation. MapLibre puts the camera centre in the middle of the un-padded
// area, so the padding goes on TOP: a third of the viewport above moves the
// centre from 1/2 to 2/3. One padding for every camera path (follow, recenter,
// centerOn), rather than a per-call offset that the paths would disagree on.
export const LOOK_AHEAD_FRACTION = 1 / 3
export function lookAheadPadding(viewportHeight, oriented) {
  const top = oriented ? Math.round((Number(viewportHeight) || 0) * LOOK_AHEAD_FRACTION) : 0
  return { top, bottom: 0, left: 0, right: 0 }
}

// compassGlyph names the icon for a compass state: 'static' (not following),
// 'following' (centred, north up), 'heading' (rotates with the device), or
// 'driving' (rotates with GPS course-over-ground). The FAB previews the NEXT
// state via compassGlyph(nextCompassState(...)), so it shows what a tap will
// do rather than the current state.
export function compassGlyph({ follow, source }) {
  if (!follow) return 'static'
  if (source === 'device') return 'heading'
  if (source === 'course') return 'driving'
  return 'following'
}

// Below this ground speed (m/s) a reported GPS course is treated as noise:
// many devices emit a jittery but non-null heading while crawling, which
// would swing the map at every stop. ~2 m/s ≈ 7 km/h, comfortably above a
// walking shuffle and below the slowest driving this mode targets.
export const COURSE_MIN_SPEED_MS = 2

// autoSource (#403): in heading mode the sensor follows the speed. At
// COURSE_MIN_SPEED_MS the GPS course takes over from the compass; it hands
// back only below COURSE_RELEASE_SPEED_MS, so a crawl at the threshold does
// not swap sensors at every fix (between the two the current sensor holds).
// An unknown speed holds too. A cleared source (a correction by two-finger
// rotate, or not following) is never armed here: after a correction nothing
// switches until the mode is cycled back (Kasper, 2026-09-05).
export const COURSE_RELEASE_SPEED_MS = 1
export function autoSource(source, speed) {
  if (source !== 'device' && source !== 'course') return null
  if (!Number.isFinite(speed)) return source
  if (speed >= COURSE_MIN_SPEED_MS) return 'course'
  if (speed < COURSE_RELEASE_SPEED_MS) return 'device'
  return source
}

// resolveCourseHeading: per the W3C Geolocation spec, heading is null when
// unavailable and NaN while stationary (#242) — hold the last known heading
// in both cases instead of snapping to north-up at every light. When the fix
// carries a usable speed below COURSE_MIN_SPEED_MS the heading is ignored as
// low-speed jitter; a null/NaN speed (unavailable) falls back to trusting
// heading availability alone.
export function resolveCourseHeading(heading, lastKnown, speed) {
  if (Number.isFinite(speed) && speed < COURSE_MIN_SPEED_MS) return lastKnown
  return Number.isFinite(heading) ? heading : lastKnown
}
