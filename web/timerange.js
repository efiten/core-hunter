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
// Clamps result to valid Date range to prevent RangeError on toISOString().
export function resolveToken(v, nowMs) {
  const s = String(v || '').trim()
  if (s === 'now') return nowMs
  if (s === 'now/d') {
    const d = new Date(nowMs)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
  }
  const m = REL_RE.exec(s)
  if (!m) return null
  const result = nowMs - Number(m[1]) * UNIT_MS[m[2]]
  // Clamp to valid Date range: roughly ±285 million years from 1970
  const minDate = -8.64e15
  const maxDate = 8.64e15
  return Math.max(minDate, Math.min(maxDate, result))
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

// toLocalInput renders an instant as the naive local `YYYY-MM-DDTHH:MM` a
// datetime-local input expects. This is LOSSY by nature: the string carries no
// zone, so on the DST fall-back night both passes through 02:30 render
// identically and the instant can no longer be recovered from it. Pair every
// render with boundFromField below rather than re-parsing the string.
export function toLocalInput(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// boundFromField reads an absolute field back to ISO-UTC without losing the
// occurrence toLocalInput dropped (#289).
//
// `rendered` is what syncTimeUi last wrote: { value, iso }. When the field
// still holds exactly that string the user did not touch it, so the honest
// answer is the instant we rendered FROM — not whatever re-parsing that string
// happens to yield. Re-parsing is correct only for a value the user typed,
// where the wall-clock reading is the intent and picking the first occurrence
// of an ambiguous hour is as good an answer as any.
export function boundFromField(fieldValue, rendered) {
  const s = String(fieldValue || '').trim()
  if (!s) return ''
  if (rendered && rendered.iso && s === rendered.value) return rendered.iso
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
// The server clamps anyone below member to a 24h window (httpapi/degrade.go,
// guestWindow). Hiding the >24h quick ranges stops a guest PICKING one, but a
// shared link can still carry `from=now-7d`, and then the label said "Last 7
// days" over 24h of data with the active marker on a hidden row (#300).
export const GUEST_WINDOW_MS = 24 * 60 * 60 * 1000

// exceedsGuestWindow: would this resolved range ask for more than the server
// will return to a degraded role? An open-ended `from` is unbounded, so yes.
export function exceedsGuestWindow(from, to, nowMs) {
  const f = resolveTimeValue(from, nowMs)
  if (!f) return true
  const fromMs = Date.parse(f)
  if (Number.isNaN(fromMs)) return false
  const t = resolveTimeValue(to, nowMs)
  const toMs = t ? Date.parse(t) : nowMs
  if (Number.isNaN(toMs)) return false
  return (toMs - fromMs) > GUEST_WINDOW_MS
}

// COLD_START_RANGE is what a first visit asks for (#492). Tokens rather than
// resolved timestamps, so the window keeps rolling and a shared link means the
// same thing to whoever opens it (#285).
//
// 30 days rather than the empty range #440 left here: an empty range reads as
// "all time" and the server does not deliver that. /api/heatmap caps at the
// newest 50 000 rows inside the bbox (server/internal/httpapi/api.go), so once
// a viewport holds more than that, older coverage drops out under a button
// that still says All time. 30 days is a window the server returns whole.
export const COLD_START_RANGE = { from: 'now-30d', to: 'now' }

// rangeForRole applies the one rule that depends on who is asking: below
// member, no range at all is not a state, because "all time" is exactly the
// promise the 50 000-row cap cannot keep. A member keeps every range, the
// empty one included.
//
// Only a COMPLETELY empty range is filled. A link carrying one bound is a
// range somebody chose, and #285 guarantees it survives as it was.
export function rangeForRole(from, to, { degraded } = {}) {
  const f = String(from || '').trim(), t = String(to || '').trim()
  if (!degraded || f || t) return { from, to }
  return { ...COLD_START_RANGE }
}

// rangeLabelFor is rangeLabel plus the note that says a layer will not cover
// the range asked for. Since #466 that is only true of the point layer:
// /api/points still clamps a sub-member caller to 24 h (applyGuestWindowCap),
// while the hex the map opens on is not windowed at all. A flat "(24 h max)"
// therefore described the layer the visitor is usually not looking at.
export function rangeLabelFor(from, to, nowMs, { degraded, showsPoints } = {}) {
  const base = rangeLabel(from, to, nowMs)
  if (!degraded || !showsPoints) return base
  return exceedsGuestWindow(from, to, nowMs) ? `${base} (points: 24 h)` : base
}

export function rangeLabel(from, to, nowMs) {
  const q = matchQuickRange(from, to)
  if (q) return q.label
  const f = String(from || '').trim(), t = String(to || '').trim()
  if (!f && !t) return 'All time'
  if (!f) return `Until ${shortAbsolute(t, nowMs)}`
  if (!t) return `From ${shortAbsolute(f, nowMs)}`
  return `${shortAbsolute(f, nowMs)} → ${shortAbsolute(t, nowMs)}`
}

// rangeIsLive: does this range still include "now"? That is the question the
// auto-refresh has to ask, and it is not the same as "is this range relative".
//
// The refresh used to run only while a RELATIVE range was active, because the
// reason it existed was to keep `now-1h` rolling. Since #440 the cold-start
// default is All time -- empty from and to, which is not a token -- so the
// timer was never created and the map never refreshed itself at all. A hunter
// watching a drive saw whatever had loaded when the page opened, for as long as
// they left it open (2026-08-24).
//
// A range that ENDS in the past is genuinely finished and needs no polling:
// nothing new can fall inside it. Everything else does, whether it is written
// as a token or left open.
export function rangeIsLive(from, to, nowMs = Date.now()) {
  const t = String(to == null ? '' : to).trim()
  if (!t) return true                       // open-ended: now is always inside it
  if (isTimeToken(t)) return true           // `now`, `now-1h`: follows the clock
  const ms = Date.parse(resolveTimeValue(t, nowMs) || t)
  if (Number.isNaN(ms)) return true         // unreadable: refresh rather than freeze
  return ms >= nowMs
}

// oldestRxAt is the earliest rx_at in a set of points. The points layer already
// holds the rows, so its date needs no extra field from the server — but the
// paged fetch concatenates pages, so this scans rather than reading the last
// element: "it happens to arrive sorted" is not something a date on screen
// should rest on.
export function oldestRxAt(points) {
  let oldest = ''
  for (const p of points || []) {
    const t = p && p.rx_at ? String(p.rx_at) : ''
    if (t && (!oldest || t < oldest)) oldest = t
  }
  return oldest
}

// coverageLabel is what the status line says after a layer has loaded, and it
// exists because "N cells (capped)" under a range button reading "All time" is
// a contradiction the reader cannot resolve.
//
// The truncation is deterministic, not arbitrary: QueryPoints is
// `ORDER BY rx_at DESC LIMIT ?`, so what comes back is the most RECENT n. That
// makes the honest statement a date rather than a warning — the map really does
// cover everything from `coversFrom` to now, and saying so tells the reader
// something useful instead of telling them not to trust what they see.
//
// Untruncated answers say nothing extra: the range button already stated the
// span, and repeating it would make the common case noisier to fix the rare one.
export function coverageLabel(count, unit, { truncated = false, coversFrom = '' } = {}, nowMs = Date.now()) {
  const head = `${count} ${unit}`
  if (!truncated) return head
  const since = shortAbsolute(coversFrom, nowMs)
  // A truncated answer with no date is still better served by the old warning
  // than by a blank claim: something is missing and we cannot say from when.
  return since ? `${head} · since ${since}` : `${head} (capped)`
}

// The long form, for the title attribute: the status line has no room for it
// and a reader who wants the mechanism should not have to guess it.
export function coverageTitle(limit, { truncated = false, coversFrom = '' } = {}, nowMs = Date.now()) {
  if (!truncated) return ''
  const since = shortAbsolute(coversFrom, nowMs)
  const head = `Showing the most recent ${limit.toLocaleString('en')} receptions`
  return since ? `${head}, from ${since} onwards. Older ones are not in this view.` : `${head}.`
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
