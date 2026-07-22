// Time-range tokens + quick ranges (#285).
//
// The viewer's `from`/`to` state carries two value kinds, and every consumer
// resolves through resolveTimeValue():
//
//   absolute  "2026-07-22T00:00"  a datetime-local string (what the two date
//                                 fields have always produced) -- a fixed
//                                 instant, reproduced exactly by a shared link
//   relative  "now-6h" / "now"    a token resolved at query time, so a rolling
//                                 window keeps following now and a shared link
//                                 means "the last 6 hours for whoever opens it"
//
// Decided (Kasper, 2026-07-22): tokens are stored in the URL as-is (Grafana's
// model), with an explicit "copy absolute link" action for when a fixed,
// exactly-reproducible link is wanted instead. #217's guarantee is untouched:
// a plain visit still gets today, since the cold default stays the absolute
// today 00:00-23:59 that defaultToday() has always written.

// Supported units. Deliberately small: these cover every quick range below,
// and each one is a fixed duration, so no calendar arithmetic is needed.
const UNIT_MS = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

const REL_RE = /^now-(\d+)([mhdw])$/

// isTimeToken reports whether a stored from/to value is a relative token
// rather than an absolute datetime-local string.
export function isTimeToken(v) {
  const s = String(v || '').trim()
  return s === 'now' || s === 'now/d' || REL_RE.test(s)
}

// resolveToken turns a relative token into epoch ms. Returns null for anything
// that isn't a token, so callers can fall through to absolute parsing.
//   now      this instant
//   now-6h   six hours ago
//   now/d    start of today, in LOCAL time -- "Today" means the user's calendar
//            day, not a UTC one
export function resolveToken(v, nowMs) {
  const s = String(v || '').trim()
  if (s === 'now') return nowMs
  if (s === 'now/d') {
    const d = new Date(nowMs)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
  }
  const m = REL_RE.exec(s)
  if (!m) return null
  return nowMs - Number(m[1]) * UNIT_MS[m[2]]
}

// resolveTimeValue renders a stored from/to value as the ISO-UTC string the
// API expects — the single conversion point for both value kinds. Empty in,
// empty out (an absent bound is not a filter).
export function resolveTimeValue(v, nowMs) {
  const s = String(v || '').trim()
  if (!s) return ''
  const tok = resolveToken(s, nowMs)
  if (tok !== null) return new Date(tok).toISOString()
  // Absolute: a datetime-local string is local time (no zone suffix), so
  // new Date() parses it in the browser's zone — same as the old localToUTC.
  const t = Date.parse(s)
  return Number.isNaN(t) ? '' : new Date(t).toISOString()
}

// The quick-range list, in display order. `from`/`to` are stored verbatim into
// the from/to state, so picking one writes tokens, not resolved timestamps.
export const QUICK_RANGES = [
  { label: 'Last 5 minutes', from: 'now-5m', to: 'now' },
  { label: 'Last 15 minutes', from: 'now-15m', to: 'now' },
  { label: 'Last 30 minutes', from: 'now-30m', to: 'now' },
  { label: 'Last 1 hour', from: 'now-1h', to: 'now' },
  { label: 'Last 3 hours', from: 'now-3h', to: 'now' },
  { label: 'Last 6 hours', from: 'now-6h', to: 'now' },
  { label: 'Last 12 hours', from: 'now-12h', to: 'now' },
  { label: 'Last 24 hours', from: 'now-24h', to: 'now' },
  { label: 'Today', from: 'now/d', to: 'now' },
  { label: 'Last 2 days', from: 'now-2d', to: 'now' },
  { label: 'Last 7 days', from: 'now-7d', to: 'now' },
  { label: 'Last 30 days', from: 'now-30d', to: 'now' },
]

// matchQuickRange finds the quick range a from/to pair corresponds to, or null
// when the pair is an absolute (or otherwise unrecognised) range.
export function matchQuickRange(from, to) {
  const f = String(from || '').trim(), t = String(to || '').trim()
  return QUICK_RANGES.find((q) => q.from === f && q.to === t) || null
}

// Compact display of an absolute bound for the button label: drop the seconds
// and the date when it is today, so the common case stays short.
function shortAbsolute(v, nowMs) {
  const t = Date.parse(String(v || '').trim())
  if (Number.isNaN(t)) return String(v || '')
  const d = new Date(t), now = new Date(nowMs)
  const p = (n) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
}

// rangeLabel is what the picker button shows: the quick-range name when the
// current pair is one, otherwise the absolute span.
export function rangeLabel(from, to, nowMs) {
  const q = matchQuickRange(from, to)
  if (q) return q.label
  const f = String(from || '').trim(), t = String(to || '').trim()
  if (!f && !t) return 'All time'
  if (!f) return `Until ${shortAbsolute(t, nowMs)}`
  if (!t) return `From ${shortAbsolute(f, nowMs)}`
  return `${shortAbsolute(f, nowMs)} → ${shortAbsolute(t, nowMs)}`
}

// absoluteShareUrl rewrites the current URL's from/to to resolved timestamps,
// so the link stays fixed instead of following now for whoever opens it — the
// escape hatch that pairs with storing tokens by default.
export function absoluteShareUrl(href, from, to, nowMs) {
  const u = new URL(href)
  const f = resolveTimeValue(from, nowMs), t = resolveTimeValue(to, nowMs)
  if (f) u.searchParams.set('from', f); else u.searchParams.delete('from')
  if (t) u.searchParams.set('to', t); else u.searchParams.delete('to')
  return u.toString()
}
