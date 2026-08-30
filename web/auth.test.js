import { describe, it, expect } from 'vitest'
import { roleRank, atLeast, canSeeLocate, canSeeObserverPoints, isDegradedFor, guestNotice, canSeePointLayer, modeForRole, pointLayerReason } from './auth.js'

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
  // #440: the hex layer is not windowed for a degraded caller, while the 24 h
  // window survives on individual receptions. A notice that says "last 24 h"
  // flat describes the layer the reader is not looking at, and undersells the
  // one they are. Since #493 the 24 h belongs to the ticker, which is the only
  // place a degraded role meets individual receptions, so the copy names it.
  it('separates unwindowed coverage from the 24 h reception window', () => {
    for (const role of ['guest', 'hunter']) {
      const n = guestNotice(role)
      expect(n, role).toMatch(/no time limit/i)
      expect(n, role).toMatch(/ticker shows the last 24 h/i)
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
  // #490 is answered by #rx-cta and the login card, not here: this line shares a
  // flex-wrap row with the SF counts, and naming the RX webapp in it pushed them
  // onto a row of their own (measured at 1440px). Kept short on purpose.
  it('stays short enough to share its bar row, and leaves registering to the controls beside it', () => {
    expect(guestNotice('guest').length).toBeLessThan(140)
    expect(guestNotice('guest')).not.toMatch(/register/i)
  })
})

// #493: the point layer is gated the way Locate and the observer layers are.
// A sub-member caller gets 24 h and 500 rows from /api/points
// (server/internal/httpapi/degrade.go), and the toggle said nothing about it,
// so the layer looked thin or empty for reasons of its own.
describe('canSeePointLayer', () => {
  it('is a member gate, same shape as canSeeLocate', () => {
    expect(canSeePointLayer('member')).toBe(true)
    expect(canSeePointLayer('admin')).toBe(true)
    expect(canSeePointLayer('hunter')).toBe(false)
    expect(canSeePointLayer('guest')).toBe(false)
    expect(canSeePointLayer(undefined)).toBe(false)
  })
})

describe('modeForRole — a deep link cannot open a gated layer', () => {
  it('holds a degraded role on hex, whatever was asked for', () => {
    for (const m of ['points', 'both', 'hex']) {
      expect(modeForRole(m, 'guest'), m).toBe('hex')
      expect(modeForRole(m, 'hunter'), m).toBe('hex')
    }
  })
  it('leaves a member on the mode they picked', () => {
    for (const m of ['points', 'both', 'hex']) expect(modeForRole(m, 'member'), m).toBe(m)
  })
})

describe('pointLayerReason', () => {
  it('says what the account gets you, not just that it is off', () => {
    const msg = pointLayerReason('guest')
    expect(msg).toMatch(/individual receptions/i)
    expect(msg).toMatch(/log in|account/i)
  })
  // A hunter is logged in already: telling them to log in is a dead end, they
  // need an admin to verify them (#174).
  it('tells a hunter what they actually need', () => {
    expect(pointLayerReason('hunter')).toMatch(/member/i)
    expect(pointLayerReason('hunter')).not.toMatch(/log in/i)
  })
  it('has nothing to say to a member', () => {
    expect(pointLayerReason('member')).toBe(null)
  })
})
