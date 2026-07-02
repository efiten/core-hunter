// gateDecision returns true when the record should be written: either the
// pubkey is new (prev undefined) or the name/location changed. Repeated,
// unchanged adverts return false so they never touch disk.
export function gateDecision(prev, rec) {
  if (!prev) return true
  return prev.name !== rec.name || prev.lat !== rec.lat || prev.lon !== rec.lon
}
