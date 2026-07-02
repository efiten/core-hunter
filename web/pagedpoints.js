// Paged /api/points fetcher. Loops limit/offset pages until the server stops
// truncating or maxTotal is reached, so callers get the full dataset instead
// of the newest single page. `capped` is true only when maxTotal cut it off —
// i.e. more matching rows exist server-side than were returned.
import { API_BASE } from './config.js'

export async function fetchPointsPaged(baseQs, { pageSize = 5000, maxTotal = 25000, apiBase = API_BASE } = {}) {
  const points = []
  for (let offset = 0; ; offset += pageSize) {
    const sep = baseQs ? '&' : ''
    const r = await fetch(`${apiBase}/api/points?${baseQs}${sep}limit=${pageSize}&offset=${offset}`)
    if (!r.ok) throw new Error(`points ${r.status}`)
    const d = await r.json()
    points.push(...(d.points || []))
    if (!d.truncated) return { points, capped: false }
    if (points.length >= maxTotal) return { points: points.slice(0, maxTotal), capped: true }
  }
}
