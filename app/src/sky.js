// Sky, driven by time of day (#397). At high pitch a large part of the viewport
// sits above the horizon, and with no sky MapLibre draws nothing there — which
// reads as a broken map rather than as sky. That is why this is not cosmetic:
// it is what makes the raised tilt ceiling (#333) usable at all.
//
// Time of day rather than a fixed colour because this app is used at dusk and
// after dark as often as in daylight, and a bright blue sky at 23:00 would be
// worse than none. Ported from the #293/#333 prototype, where the palette was
// evaluated on device; the theme cap below is the one part that is new.

// The palette is written as literal hex, and it is the only colour in the app
// that is. AGENTS.md's "colours via CSS variables only" is scoped to component
// stylesheets, and this is neither a stylesheet nor a UI surface: it is nine
// stops x three channels feeding MapLibre paint properties, which no rule can
// read from CSS anyway, and as tokens it would be 27 names nobody would ever
// theme individually. The consequence, stated rather than left to be
// discovered: the light theme gets this same palette. Only the dark cap below
// is theme-aware, so what the sky follows is the clock, and the theme changes
// nothing except a brightness ceiling. That is deliberate — the sky above a
// map is the same sky at 14:00 whichever basemap is under it — but it does
// mean a light-theme user at night gets a night sky, not a light-theme sky.
//
// Anchor colours across the day. Between them everything is interpolated, so
// the sky changes continuously instead of snapping between four looks.
export const SKY_STOPS = [
  { h: 0, sky: '#05070f', horizon: '#0a1020', fog: '#0a1020' },    // night
  { h: 5.5, sky: '#141d38', horizon: '#3b3350', fog: '#2a2740' },  // astronomical dawn
  { h: 7, sky: '#3f6ea8', horizon: '#e8a06a', fog: '#c9a58a' },    // sunrise
  { h: 10, sky: '#4a86c8', horizon: '#bcd6ea', fog: '#c5d8e8' },   // morning
  { h: 14, sky: '#4287d0', horizon: '#c3daf0', fog: '#cbdcec' },   // day
  { h: 18, sky: '#4a7fb5', horizon: '#e6b183', fog: '#d3b295' },   // golden hour
  { h: 20, sky: '#2a3a63', horizon: '#c2704f', fog: '#7a5a5a' },   // sunset
  { h: 21.5, sky: '#101a33', horizon: '#3a3352', fog: '#241f38' }, // dusk
  { h: 24, sky: '#05070f', horizon: '#0a1020', fog: '#0a1020' },   // night again
]

// Brightness ceiling for the dark theme, in Rec. 709 relative luminance over
// 0..255. The clock still picks the colour; this only stops a midday sky from
// glaring above a dark basemap. Chosen so the night and dusk stops pass through
// untouched (dusk sky is ~21, horizon ~52) while the daylight horizon (~215)
// comes down hard. The light theme is uncapped: there a bright sky agrees with
// a bright map.
export const DARK_MAX_LUMA = 90

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mixHex = (a, b, t) => {
  const [ar, ag, ab] = hexToRgb(a), [br, bg, bb] = hexToRgb(b)
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t])
}
const relLuma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// Scales all three channels by one factor rather than clamping each: that keeps
// the ratios between them, so a capped day sky is still blue instead of washing
// toward grey. Under the cap it is the identity, which is what leaves night
// alone.
function capLuma(hex, maxLuma) {
  const c = hexToRgb(hex)
  const l = relLuma(c)
  if (l <= maxLuma) return hex
  const k = maxLuma / l
  return rgbToHex(c.map((v) => v * k))
}

// hour is a float, 0..24 (13.5 = 13:30); values outside wrap. theme is the
// --ch-basemap token, and only the exact string 'dark' caps: an unknown value
// is treated as light, so a token this module has never heard of degrades to
// the uncapped palette rather than to a hard-coded guess.
//
// A *missing* token is the caller's decision, not this module's. huntmap.js
// resolves it before calling — cssVar('--ch-basemap') || 'dark' — the same
// expression styleFor() already uses to pick the basemap, because a token that
// reads empty means the stylesheet has not applied and the app's own default
// is dark. So in the app a missing token gets the capped palette; here, passed
// through raw, it would get the light one.
export function skyForHour(hour, theme) {
  const h = ((hour % 24) + 24) % 24
  let a = SKY_STOPS[0], b = SKY_STOPS[SKY_STOPS.length - 1]
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (h >= SKY_STOPS[i].h && h <= SKY_STOPS[i + 1].h) { a = SKY_STOPS[i]; b = SKY_STOPS[i + 1]; break }
  }
  const span = b.h - a.h
  const t = span > 0 ? (h - a.h) / span : 0
  const cap = theme === 'dark' ? (c) => capLuma(c, DARK_MAX_LUMA) : (c) => c
  return {
    'sky-color': cap(mixHex(a.sky, b.sky, t)),
    'horizon-color': cap(mixHex(a.horizon, b.horizon, t)),
    'fog-color': cap(mixHex(a.fog, b.fog, t)),
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.1,
  }
}

// Local wall-clock hour as a float. Split out so the caller stays testable and
// the clock read is in one place.
export function currentHour(now = new Date()) {
  return now.getHours() + now.getMinutes() / 60
}
