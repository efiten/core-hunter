// Per-SF node-count line for the top bar, e.g. "SF7 : 180 nodes | SF8 : 1520 nodes".
// Sources that fail (network, HTTP error, unexpected shape) are omitted; ''
// when none respond so the caller can leave the bar untouched.
import { NODE_COUNT_SOURCES } from './config.js'

export async function nodeCountsText(sources = NODE_COUNT_SOURCES) {
  const parts = await Promise.all(sources.map(async (s) => {
    try {
      const r = await fetch(s.url)
      if (!r.ok) return null
      const n = s.pick(await r.json())
      return Number.isFinite(n) ? `${s.label} : ${n} nodes` : null
    } catch {
      return null
    }
  }))
  return parts.filter(Boolean).join(' | ')
}
