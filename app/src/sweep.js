// Which repeater to probe next when nothing is selected (#479).
//
// With a target selected the app probes that target and nothing else — the hunt
// is the point, and airtime spent elsewhere is airtime not spent on it. With no
// selection the app is mapping, and then the useful thing is to make as many of
// the nodes around us transmit as possible: a trace-ping is answered by a
// retransmission we hear zero-hop, which is a measurement of that node at our
// position, and the firmware rate-limits it not at all (unlike Discover at 4 per
// 120 s and an anonymous request at 4 per 180 s).
//
// So the sweep is a rotation over what we can hear, and the only thing it has to
// get right is not wasting the rotation on nodes that will not answer.

// Consecutive unheard asks → how long before that node may be asked again.
// The first ask is free; the last step repeats. These are short compared with
// coredrive-rx's region-discovery backoff (5/15/30 min) on purpose: that one
// waits out a shared 4-per-180 s budget, this one only waits out a node being
// out of range, and out of range changes as fast as the hunter drives.
export const RETRY_BACKOFF_MS = [0, 30000, 120000, 600000]

export function retryBackoffFor(attempts) {
  if (attempts <= 0) return 0
  return RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)]
}

// Heard since we asked = in range now, whatever the clock says. That covers the
// answer itself (a reply is a reception like any other) and any other traffic
// from the node, which is the cheaper signal of the two and just as good: a node
// whose transmission we can hear is a node whose reply we can hear.
function heardSinceAsk(id, { heardAt, lastAskedAt }) {
  const asked = lastAskedAt.get(id)
  if (asked == null) return false
  return (heardAt.get(id) ?? 0) > asked
}

export function isSweepDue(id, ctx) {
  const asked = ctx.lastAskedAt.get(id)
  if (asked == null) return true
  if (heardSinceAsk(id, ctx)) return true
  return ctx.now - asked >= retryBackoffFor(ctx.attempts.get(id) ?? 0)
}

// How many nodes one cycle sweeps. Each ping is staggered by STAGGER_MS (1.5 s)
// so the companion's 16-slot send queue drains one packet per slot, so four is
// 6 s of a 10 s cycle — the discover broadcast, the four pings and their replies
// all fit, and the queue is empty again before the next tick. Higher would start
// pushing pings into the following cycle; the ceiling is the queue, not the duty
// cycle, which a direction-finding tool spends deliberately.
export const SWEEP_BATCH = 4

// nextSweepBatch picks this cycle's nodes: distinct, in rotation order, skipping
// the ones inside their backoff. Answering nodes go first; a node that has been
// asked and not heard is demoted rather than dropped, because silence is
// ambiguous — out of range, forwarding disabled, or simply busy — and dropping it
// would lose a node that was behind a building for one stretch. Fewer than
// `size` when fewer are due: it never pads the batch by asking one node twice,
// which would send the byte-identical frame and buy nothing.
export function nextSweepBatch(candidates, ctx, size = SWEEP_BATCH) {
  const due = (candidates || []).filter((id) => isSweepDue(id, ctx))
  if (!due.length) return []
  const answering = due.filter((id) => (ctx.attempts.get(id) ?? 0) <= 1)
  const pool = answering.length ? answering : due
  const out = []
  for (let i = 0; i < Math.min(size, pool.length); i++) out.push(pool[(ctx.cursor + i) % pool.length])
  return out
}

// noteAsk records that a ping went out. The attempt count is consecutive asks
// that went unheard, so hearing the node in between starts it over — which is
// what keeps a repeater we drove back towards from sitting out its old backoff.
export function noteAsk(id, ctx, now) {
  const attempts = new Map(ctx.attempts)
  const lastAskedAt = new Map(ctx.lastAskedAt)
  attempts.set(id, heardSinceAsk(id, ctx) ? 1 : (attempts.get(id) ?? 0) + 1)
  lastAskedAt.set(id, now)
  return { attempts, lastAskedAt }
}
