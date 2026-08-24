import { describe, it, expect } from 'vitest'
import { roleRank, atLeast, canSeeLocate, canSeeObserverPoints, isDegradedFor, guestNotice } from './auth.js'

describe('role helpers', () => {
  it('ranks roles', () => {
    expect(roleRank('guest')).toBe(0)
    expect(roleRank('hunter')).toBe(1)
    expect(roleRank('member')).toBe(2)
    expect(roleRank('admin')).toBe(3)
    expect(roleRank('bogus')).toBe(0)
  })
  it('atLeast compares by rank', () => {
    expect(atLeast('admin', 'member')).toBe(true)
    expect(atLeast('hunter', 'member')).toBe(false)
  })
  it('gates locate + observer-points to member+', () => {
    expect(canSeeLocate('member')).toBe(true)
    expect(canSeeLocate('hunter')).toBe(false)
    expect(canSeeLocate('guest')).toBe(false)
    expect(canSeeObserverPoints('admin')).toBe(true)
    expect(canSeeObserverPoints('guest')).toBe(false)
  })
  it('flags degraded view below member', () => {
    expect(isDegradedFor('guest')).toBe(true)
    expect(isDegradedFor('hunter')).toBe(true)
    expect(isDegradedFor('member')).toBe(false)
  })
  it('guestNotice only for guest/hunter', () => {
    expect(guestNotice('guest')).toMatch(/24 h|coarse|approximate/i)
    expect(guestNotice('member')).toBeNull()
  })
  // #440: the map opens on the hex layer, which is all-time for a degraded
  // caller, while the 24 h window survives only on individual receptions. A
  // notice that says "last 24 h" flat describes the layer the reader is not
  // looking at -- and undersells the one they are, which is the whole point of
  // the change.
  it('separates all-time coverage from the 24 h reception window', () => {
    for (const role of ['guest', 'hunter']) {
      const n = guestNotice(role)
      expect(n, role).toMatch(/all-time coverage/i)
      expect(n, role).toMatch(/receptions show the last 24 h/i)
      // The old copy opened by claiming the whole view was 24h-bounded.
      expect(n, role).not.toMatch(/^(Guest|Hunter) view: last 24 h/)
    }
  })
  it('hunter also sees the degraded notice (own data is exact server-side, global is coarse)', () => {
    expect(guestNotice('hunter')).not.toBeNull()
  })
  it('tells an anonymous guest to log in, but a hunter (already logged in) to seek member verification', () => {
    expect(guestNotice('guest')).toMatch(/log in/i)
    expect(guestNotice('hunter')).toMatch(/member/i)
    expect(guestNotice('hunter')).not.toMatch(/log in/i)
  })
  // #316: the hunter copy used to read as if everything were degraded, which is
  // wrong and discouraging — the server gives a hunter their OWN companion's
  // captures in full (httpapi/api.go: ownsCompanion -> exact, full history) and
  // degrades only other hunters' data. Say which is which, and that only an
  // admin can lift it.
  it('tells a hunter how to reach their own captures in full, and who lifts the rest', () => {
    const n = guestNotice('hunter')
    expect(n).toMatch(/your own companion/i)
    expect(n).toMatch(/admin/i)
    // The qualification is the point (#316 review): /api/heatmap only exempts
    // own rows behind a single-hunter filter, and hex is the cold default, so
    // an unqualified "your own companion in full" is wrong on the layer a
    // hunter lands on. The copy must say what to do, not just what exists.
    expect(n).toMatch(/filter to your own companion/i)
  })
  it('does not promise a guest any exact data — they have no companion of their own', () => {
    expect(guestNotice('guest')).not.toMatch(/your own/i)
  })
})
