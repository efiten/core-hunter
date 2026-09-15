// sinceLabel — compact "time since last packet" label for the HUD.
// Pure: given the current time and the last-seen time (both ms epoch), returns
// a short human string. null/undefined lastMs → '' (nothing heard yet: the HUD
// leaves its age slot empty, #618).
// A future lastMs (clock skew) clamps to 0s rather than showing a negative age.
export function sinceLabel(nowMs, lastMs) {
  if (lastMs == null) return ''
  const s = Math.max(0, Math.floor((nowMs - lastMs) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
