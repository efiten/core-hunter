// Attributing a trace reply to the node we asked (#481).
//
// A trace-ping is the app's most effective probe: a repeater retransmits it with
// no rate limit of any kind (src/Mesh.cpp in the firmware forwards a DIRECT TRACE
// on a hash match, and a repeater's allowPacketForward only tests disable_fwd for
// a direct packet). Since #455 that retransmission is captured like any other
// reception — but with no sender, because classifyReception rightly refuses to
// read a TRACE packet's path bytes as node ids: they are per-hop SNR values.
//
// That default is correct for traffic we merely overheard. It is wrong for a
// packet we provoked: we generated the tag, the firmware echoes it back in the
// retransmission, and a packet carrying it is certainly the reply to our own
// probe. Refusing to say so leaves the measurement of the node being hunted on
// the map as an anonymous point that Locate never sees.
//
// What this does NOT establish is which node with that first id byte answered —
// buildTracePathFrame addresses the first hop with ONE byte, so a 1-in-256
// collision answers exactly like the target would. The tag narrows the claim to
// "this is the reply to our probe"; it does not widen it to "this id is proven".
// Where we can see the ambiguity — two live pings addressing the same byte — we
// refuse it below rather than pick one.

// How long a sent ping may still be answered. A zero-hop reply is back within a
// second or so (airtime plus the firmware's randomised direct-retransmit delay),
// so this is generous by two orders of magnitude — deliberately, because a late
// match costs nothing (the reception is a real measurement of that node at the
// position we were standing when it arrived) while a premature expiry throws the
// attribution away.
export const TRACE_TTL_MS = 30000

// The decoder reports a TRACE tag as 8 hex characters, uppercase for the letters;
// the app holds the same value as a 32-bit number. One notation for both sides.
export function normalizeTag(tag) {
  if (typeof tag === 'number') {
    if (!Number.isInteger(tag) || tag < 0 || tag > 0xffffffff) return null
    return tag.toString(16).padStart(8, '0')
  }
  if (typeof tag === 'string' && /^[0-9a-f]{1,8}$/i.test(tag.trim())) {
    return tag.trim().toLowerCase().padStart(8, '0')
  }
  return null
}

function live(pending, now, ttlMs) {
  return (pending || []).filter((p) => now - p.sentAt < ttlMs)
}

// prunePings drops the pings that can no longer be answered, so the list stays
// the size of one cycle's worth of probes rather than the session's.
export function prunePings(pending, now, ttlMs = TRACE_TTL_MS) {
  return live(pending, now, ttlMs)
}

export function rememberPing(pending, tag, targetId, sentAt, ttlMs = TRACE_TTL_MS) {
  const t = normalizeTag(tag)
  if (!t || !targetId) return pending || []
  return [...prunePings(pending, sentAt, ttlMs), { tag: t, targetId: String(targetId).toLowerCase(), sentAt }]
}

// matchTraceTarget answers "whose reply is this", or null when it cannot say.
export function matchTraceTarget(pending, tag, now, ttlMs = TRACE_TTL_MS) {
  const t = normalizeTag(tag)
  if (!t) return null
  const open = live(pending, now, ttlMs)
  const hit = open.find((p) => p.tag === t)
  if (!hit) return null
  // The frame names its first hop by one byte, so two live pings sharing that
  // byte are two nodes either of which could have sent this. Ambiguity is
  // evidence against attributing, never for it (AGENTS §7).
  const firstByte = hit.targetId.slice(0, 2)
  if (open.some((p) => p !== hit && p.targetId.slice(0, 2) === firstByte)) return null
  return hit.targetId
}
