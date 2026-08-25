// What "Direct only" will do to the set on screen, and why (#454 follow-up).
//
// The control filters on `hops === 0`, which reads as "only what I heard from
// nearby". It never meant that — it meant "we heard the originator, not a
// relay" — and the sender writes the hop count, so it does not reliably mean
// even that.
//
// On 2026-08-24 an Amsterdam hunt met a flood sent with a pre-filled path:
// 2,851 receptions, hop counts claiming 1 to 37, and NOT ONE claiming zero,
// including three heard at -34 dBm — a few metres away. Ticking Direct only
// emptied the map. Nothing said why, so the tool looked broken at the moment
// it was most needed.
//
// This does not decide whether a hop count was forged; that cannot be done from
// a single reception and a spike (#321) settled it. It reports something
// weaker and entirely checkable: what this control would do to THIS set.

// Normal traffic runs 28-43% zero-hop in every RSSI band (30 days, all
// hunters). A set with none at all is not a filter with nothing to show, it is
// a filter that cannot show anything.
export function hopFilterEffect(points) {
  const rows = Array.isArray(points) ? points : []
  let total = 0
  let zero = 0
  let strongest = null
  for (const p of rows) {
    if (!p || typeof p.hops !== 'number') continue
    total++
    if (p.hops === 0) zero++
    if (typeof p.rssi === 'number' && (strongest === null || p.rssi > strongest)) strongest = p.rssi
  }
  return { total, zero, strongest, hidesEverything: total > 0 && zero === 0 }
}

// The minimum before saying anything. Against a 30% baseline, seeing no
// zero-hop reception in 20 is a 0.08% coincidence; in 5 it is 17%, which is an
// ordinary quiet minute rather than a finding. Warning on a handful would make
// the notice noise, and a notice people learn to ignore is worse than none.
export const HOP_NOTICE_MIN = 20

// warnHopFilter is the line to show beside the control, or '' for nothing.
// Deliberately about the DATA, never about the sender: "none of these claims to
// be direct" is checkable, "this sender is lying" is not.
export function warnHopFilter(points, { active = false } = {}) {
  const e = hopFilterEffect(points)
  if (e.total < HOP_NOTICE_MIN || !e.hidesEverything) return ''
  const near = typeof e.strongest === 'number' && e.strongest >= -60
    ? ` — including some at ${e.strongest} dBm, which is close`
    : ''
  return active
    ? `Direct only is hiding all ${e.total.toLocaleString('en')} receptions here: none of them reports zero hops${near}. The hop count is written by the sender, so it cannot be relied on to mean "nearby".`
    : `None of the ${e.total.toLocaleString('en')} receptions here reports zero hops${near}, so Direct only would hide every one of them.`
}
