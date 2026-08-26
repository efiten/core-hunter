import { describe, it, expect, beforeEach, vi } from 'vitest'
import { roleRose, roleNotice, loadSeenRole, saveSeenRole } from './rolechange.js'

describe('roleRose', () => {
  // The case the whole thing exists for.
  it('fires when a hunter is verified as a member', () => {
    expect(roleRose('hunter', 'member')).toBe(true)
  })

  it('fires on every other step up, including guest to hunter', () => {
    expect(roleRose('guest', 'hunter')).toBe(true)
    expect(roleRose('guest', 'member')).toBe(true)
    expect(roleRose('member', 'admin')).toBe(true)
  })

  it('says nothing when the role has not moved', () => {
    for (const r of ['guest', 'hunter', 'member', 'admin']) {
      expect(roleRose(r, r)).toBe(false)
    }
  })

  // A demotion is someone else's decision to explain. A banner is the wrong way
  // to hear it, and the wording would be wrong for it in any case.
  it('says nothing on the way down', () => {
    expect(roleRose('member', 'hunter')).toBe(false)
    expect(roleRose('admin', 'guest')).toBe(false)
  })

  // Without a stored value a promotion cannot be told apart from an arrival, so
  // announcing one would greet every existing member with news about a change
  // that did not happen. This is what makes the first load record-only.
  it('says nothing on a first visit, whatever the role is', () => {
    for (const r of ['guest', 'hunter', 'member', 'admin']) {
      expect(roleRose(null, r)).toBe(false)
      expect(roleRose('', r)).toBe(false)
      expect(roleRose(undefined, r)).toBe(false)
    }
  })

  // An unknown value ranks 0, so a stored role this build no longer knows must
  // not read as a promotion to everything above it.
  it('treats an unreadable stored value as no information, not as the bottom rank', () => {
    expect(roleRose('nonsense', 'member')).toBe(true)
    expect(roleRose('nonsense', 'guest')).toBe(false)
  })
})

describe('roleNotice', () => {
  it('names what actually opened up, not that a role changed', () => {
    expect(roleNotice('member')).toMatch(/verified you as a member/i)
    expect(roleNotice('member')).toMatch(/Locate/)
    expect(roleNotice('hunter')).toMatch(/own companion/i)
    expect(roleNotice('admin')).toMatch(/admin/i)
  })

  it('has nothing to say about a guest, which is not a promotion anyone reaches', () => {
    expect(roleNotice('guest')).toBe('')
    expect(roleNotice('')).toBe('')
    expect(roleNotice(undefined)).toBe('')
  })
})

describe('the stored last-seen role', () => {
  beforeEach(() => {
    const store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    })
  })

  it('round-trips', () => {
    expect(loadSeenRole()).toBeNull()
    saveSeenRole('member')
    expect(loadSeenRole()).toBe('member')
  })

  // Private mode throws on setItem. A notice is not worth failing a page load
  // for, so both sides swallow it and the reader simply gets told again later.
  it('survives storage that refuses to be written or read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(() => saveSeenRole('member')).not.toThrow()
    expect(loadSeenRole()).toBeNull()
  })
})
