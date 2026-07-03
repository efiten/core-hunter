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
  it('hunter also sees the degraded notice (own data is exact server-side, global is coarse)', () => {
    expect(guestNotice('hunter')).not.toBeNull()
  })
})
