import { haversineM } from './locate.js'

// Session route trail (#148): the hunter's own driven/walked GPS track, so you
// can see which streets you've already covered. appendTrailPoint adds a fix to
// the trail, skipping fixes that haven't moved far enough (GPS jitter while
// stationary would otherwise bloat the polyline). Returns a NEW array when it
// appends, or the SAME array unchanged when it skips — so the caller only
// redraws when the reference changes. Pure; huntmap.js owns the running array.
export function appendTrailPoint(trail, lat, lon, minMoveM = 5) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return trail
  const last = trail[trail.length - 1]
  if (last && haversineM({ lat: last[0], lon: last[1] }, { lat, lon }) < minMoveM) return trail
  return [...trail, [lat, lon]]
}
