// The rolling time windows both surfaces offer, in display order (#557). The
// map's quick ranges and the app's "Plot last" select are built from this one
// list, so a duration that exists on both carries the same label. Before this
// the app said "1 h" where the map said "Last 1 hour", and offered nothing
// between an hour and all time: a hunt that ran the whole afternoon had no
// window that fit.
//
// Copied byte-for-byte into app/src/ and web/ (web/parity.test.js pins it):
// neither deploy path can ship a file outside its own directory.
//
// Each entry is the token the map already stores in a share link as
// `now-<token>`; the app resolves it to milliseconds with windowMs. What a
// surface offers beyond this list is its own: the map adds Today (anchored to
// midnight, which a rolling window is not) and Last 30 days (past the app's
// 7-day retention); the app adds All time.
export const TIME_WINDOWS = [
  { token: '5m', label: '5 minutes' },
  { token: '15m', label: '15 minutes' },
  { token: '30m', label: '30 minutes' },
  { token: '1h', label: '1 hour' },
  { token: '3h', label: '3 hours' },
  { token: '6h', label: '6 hours' },
  { token: '12h', label: '12 hours' },
  { token: '24h', label: '24 hours' },
  { token: '2d', label: '2 days' },
  { token: '7d', label: '7 days' },
]

const UNIT_MS = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }

// windowMs resolves a bare token ("5m", "1h", "2d") to a duration. Anything
// else is null rather than 0: the app's select uses 0 for All time, and a
// typo in the list must not quietly become that.
export function windowMs(token) {
  const m = /^(\d+)([mhd])$/.exec(String(token ?? ''))
  return m ? Number(m[1]) * UNIT_MS[m[2]] : null
}

// widerWindowMs is the window to step to when a surface shows something that
// reaches further back than it draws (#646): the first entry on the list that
// is wider than the one in use and far enough to take `neededMs`, the oldest
// thing on show. The smallest step that actually helps, not the widest one
// there is.
//
// null means this list has nothing to offer: the window is already All time,
// nothing on show falls outside it, or what does reaches past the longest
// preset — and the app's All time is the step beyond this list, which is its
// own to offer.
export function widerWindowMs(neededMs, currentMs) {
  if (currentMs == null) return null
  if (!(neededMs > currentMs)) return null
  for (const w of TIME_WINDOWS) {
    const ms = windowMs(w.token)
    if (ms > currentMs && ms >= neededMs) return ms
  }
  return null
}
