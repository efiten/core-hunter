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

// ageFade returns an opacity multiplier for a reception's age within the
// active time window: 1 when brand-new, linearly down to AGE_FADE_FLOOR at the
// window edge (#149). Old points fade instead of vanishing hard, so recent
// versus stale is readable at a glance. With no time window (windowMs null),
// or an unusable rx_at, nothing fades.
const AGE_FADE_FLOOR = 0.15
export function ageFade(rxAt, nowMs, windowMs) {
  if (windowMs == null || !(windowMs > 0)) return 1
  const t = Date.parse(rxAt)
  if (Number.isNaN(t)) return 1
  const frac = Math.max(0, Math.min(1, (nowMs - t) / windowMs))
  return 1 - (1 - AGE_FADE_FLOOR) * frac
}

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
