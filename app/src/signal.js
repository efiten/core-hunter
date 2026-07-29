export function snrTier(snr) {
  if (snr == null) return 'none'
  if (snr >= -2) return 'hot'
  if (snr >= -5) return 'warm'
  if (snr >= -9) return 'mid'
  if (snr >= -14) return 'cool'
  return 'cold'
}
export function tierColorVar(tier) { return `--ch-sig-${tier}` }
const OPACITY = { hot: 0.7, warm: 0.58, mid: 0.46, cool: 0.34, cold: 0.24, none: 0.18 }
export function fillOpacity(tier) { return OPACITY[tier] ?? 0.18 }

// effectivePlotOffset combines the per-device calibration offset with the active
// attenuator setting. An attenuator lowers the measured RSSI, so its magnitude is
// added back for plotting — attenuatorDb is the (non-positive) setting (e.g. -20),
// and subtracting it adds +20 on top of the calibration. Display-only: stored and
// published RSSI stay raw.
export function effectivePlotOffset(calibrationOffset = 0, attenuatorDb = 0) {
  return (calibrationOffset || 0) - (attenuatorDb || 0)
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

// heatWeight maps an RSSI (dBm) to a 0.05–1 weight for the map's Locate density
// heatmap — the weak end (-115) → 0.05, the strong end (-70) → 1, clamped. A
// small floor keeps weak-but-present receptions visible in the cloud.
export function heatWeight(rssi) {
  return Math.max(0.05, Math.min(1, (rssi + 115) / 45))
}

// Fixed RSSI dBm bands (iteration 2): hot = strong = close. `offset` is an
// optional per-device calibration value (dBm) added before banding.
export function rssiTier(rssi, offset = 0) {
  if (rssi == null) return 'none'
  const v = rssi + offset
  if (v >= -80) return 'hot'
  if (v >= -90) return 'warm'
  if (v >= -100) return 'mid'
  if (v >= -110) return 'cool'
  return 'cold'
}

// extrusionHeight maps an RSSI tier to a 3D hex-bar height in metres (#147
// phase 2). Bucketed by the same fixed dBm bands as rssiTier/tierColorVar, so
// a bar's height and colour always agree on the same tier.
const EXTRUSION_HEIGHT = { hot: 90, warm: 68, mid: 48, cool: 30, cold: 15, none: 0 }
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
