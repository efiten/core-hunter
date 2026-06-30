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
