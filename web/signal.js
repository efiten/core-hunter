export function snrTier(snr) {
  if (snr == null) return 'none'
  if (snr >= -2) return 'hot'
  if (snr >= -5) return 'warm'
  if (snr >= -9) return 'mid'
  if (snr >= -14) return 'cool'
  return 'cold'
}
export function tierColorVar(tier) { return `--ch-sig-${tier}` }
const OPACITY = { hot: 0.7, warm: 0.58, mid: 0.46, cool: 0.34, cold: 0.26, faint: 0.19, none: 0.15 }
export function fillOpacity(tier) { return OPACITY[tier] ?? 0.15 }

// What a 3D pillar says about the ride it belongs to (#647). Everything from
// this ride keeps its tier's own opacity; everything from before takes one flat
// value, off the tier scale entirely, so within one colour "this ride" is
// always the more present of the two and nothing from this ride can imitate a
// backlog pillar.
//
// One value rather than a factor per tier, which is what a factor cannot give:
// tier x 0.5 would put a backlog hot pillar (0.35) exactly where a this-ride
// cool one sits (0.34), and the whole point is that the ride is a yes or no.
//
// 0.12 is below the weakest tier that draws at all. `none` is 0.15 on paper but
// its extrusion height is 0, so nothing is drawn for it and `faint` at 0.19 is
// the real floor. Measured against the dark ground on 2026-09-14 (MapLibre
// 4.7.1, with the #412 style light): 0.12 stands 15 levels off the ground where
// faint stands 31, present but plainly the weaker of the two.
export const BACKLOG_PILLAR_ALPHA = 0.12
export function pillarAlpha(tier, backlog) {
  return backlog ? BACKLOG_PILLAR_ALPHA : fillOpacity(tier)
}

// effectivePlotOffset combines the per-device calibration offset with the active
// attenuator setting. An attenuator lowers the measured RSSI, so its magnitude is
// added back for plotting — attenuatorDb is the (non-positive) setting (e.g. -20),
// and subtracting it adds +20 on top of the calibration. Display-only: stored and
// published RSSI stay raw.
export function effectivePlotOffset(calibrationOffset = 0, attenuatorDb = 0) {
  return (calibrationOffset || 0) - (attenuatorDb || 0)
}

// The continuous weak..strong RSSI span, shared by the HUD thermal bar and the
// ping pitch/gain (sound.js) so a reception sounds as hot as it looks. Kept in
// one place because they drifted apart from the tier bands once already: the
// weak anchor was -115, which pinned the whole sub -115 fringe — 13% of
// production receptions — to the far left of the bar and the lowest ping (#282).
export const RSSI_WEAK_DBM = -125
export const RSSI_STRONG_DBM = -75

// rssiFrac maps a calibrated RSSI onto 0..1 across that span, clamped.
export function rssiFrac(rssi, offset = 0) {
  if (rssi == null) return 0
  const v = Math.max(RSSI_WEAK_DBM, Math.min(RSSI_STRONG_DBM, rssi + offset))
  return (v - RSSI_WEAK_DBM) / (RSSI_STRONG_DBM - RSSI_WEAK_DBM)
}

// rssiToPct is the HUD thermal-bar marker position (0-100%). A reception with
// no RSSI parks at 10% rather than flush against the weak end, so the marker
// stays visible as a marker.
export function rssiToPct(rssi, offset = 0) {
  if (rssi == null) return 10
  return Math.round(rssiFrac(rssi, offset) * 100)
}

// ageFade used to live here (#149): an opacity multiplier for a reception's
// age within the window, 1 when new and down to a 0.15 floor at the edge. It
// went in #648, and the reason is worth keeping so it is not reinvented.
//
// It measured against the time window rather than against the drive, so a
// short ride in a wide window sat in the top few percent of its own scale: a
// 30-minute window with an 8-minute ride faded 1 to 0.77, and All time with a
// two-hour ride faded 1 to 0.99. The gradient it promised was usually
// invisible. What it cost was the whole alpha channel, which is the only
// per-feature channel a pillar has (#302).
//
// Both halves of what it encoded are answered elsewhere and on the surface
// where they are visible: the pulse (#556) says something is arriving now, and
// the ride step says something is from before. The map never carried the fade
// at all, so dropping it converges the two surfaces (#644) rather than porting
// a third rule across.

// Fixed RSSI dBm bands (iteration 2): hot = strong = close. `offset` is an
// optional per-device calibration value (dBm) added before banding.
//
// The weak end runs to -115/'faint' rather than stopping at -110 (#282): LoRa
// decodes far below -110, and on production data 26% of all receptions — 35%
// of the zero-hop ones direction-finding relies on — sat below it, i.e. one
// flat colour over the fringe where coverage actually ends. The split is at
// -115 because that halves the fringe almost exactly (13% / 13%).
export function rssiTier(rssi, offset = 0) {
  if (rssi == null) return 'none'
  const v = rssi + offset
  if (v >= -80) return 'hot'
  if (v >= -90) return 'warm'
  if (v >= -100) return 'mid'
  if (v >= -110) return 'cool'
  if (v >= -115) return 'cold'
  return 'faint'
}

// extrusionHeight maps an RSSI tier to a 3D hex-bar height in metres (#147
// phase 2). Bucketed by the same fixed dBm bands as rssiTier/tierColorVar, so
// a bar's height and colour always agree on the same tier.
const EXTRUSION_HEIGHT = { hot: 90, warm: 68, mid: 48, cool: 30, cold: 15, faint: 7, none: 0 }
export function extrusionHeight(rssi, offset = 0) {
  return EXTRUSION_HEIGHT[rssiTier(rssi, offset)]
}

// withAlpha bakes an alpha into a CSS colour so it can travel as a per-feature
// value. MapLibre's fill-extrusion-opacity is not data-driven — it is one
// number for the whole layer — but fill-extrusion-color IS, so the pillars can
// only carry tier opacity and age-fade if the alpha rides in the colour (#302).
//
// Accepts the #rgb / #rrggbb the --ch-sig-* tokens resolve to. Anything else is
// returned unchanged rather than guessed at, so a token that is already
// rgb()/rgba() degrades to "no fade" instead of an invalid paint value.
export function withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha)))
  if (!Number.isFinite(a)) return color
  const s = String(color || '').trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (!m) return color
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`
}

// tintOver pre-mixes a colour over a background at an alpha, as the GPU
// composites the flat layer's tier opacity over the basemap, and returns the
// opaque result (#412). The 3D bars use it so a bar carries the same tint its
// cell has, without translucency: a translucent extrusion compounds its own
// faces and z-fights its neighbours' shared walls (#402), an opaque one does
// not. Accepts the #rgb / #rrggbb the tokens resolve to; anything else is
// returned unchanged rather than guessed at.
export function tintOver(color, background, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha)))
  const parse = (c) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim())
    if (!m) return null
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const fg = parse(color), bg = parse(background)
  if (!fg || !bg || !Number.isFinite(a)) return color
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0')
  return '#' + fg.map((v, i) => hex(v * a + bg[i] * (1 - a))).join('')
}

// pillarTint: what a 3D bar of this tier is painted, opaque: the tier colour
// at the tier's opacity over the theme background, which is what the flat
// cell under it composites to. Measured 2026-09-05 (dark theme): a faint bar
// used to stand at 85% solid purple on a 19% tint; with this it is within a
// few levels of its cell at every tier.
//
// `dim` multiplies the tier's opacity (#624): with a coverage star selected, a
// bar outside it steps back by the same factor as its flat cell, so the two
// still agree. Pre-mixed, so a dimmed bar moves toward the ground on both
// themes. 1 leaves it exactly as it was.
export function pillarTint(tier, tokenColor, background, dim = 1) {
  return tintOver(tokenColor, background, fillOpacity(tier) * dim)
}

// The style light MapLibre shades every extrusion face with. Its default
// (intensity 0.5) darkened a hot bar 7% against its cell; 0.15 measured 2%,
// and buildings-3d keeps enough shading to read as shapes (#412, measured
// 2026-09-05 in the browser at both). Set from addOverlays on every style
// load, since setStyle drops it.
export const EXTRUSION_LIGHT_INTENSITY = 0.15
