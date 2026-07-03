import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateRegistration, buildRegisterBody, buildLoginBody, buildLinkBody, fetchMe, postAuth, accountDisplayState } from '../auth.js'

describe('validateRegistration', () => {
  const ok = { username: 'alice', password: '0123456789', companionPubkey: 'ab'.repeat(32) }
  it('accepts a valid registration', () => {
    expect(validateRegistration(ok)).toEqual([])
  })
  it('rejects a blank username', () => {
    expect(validateRegistration({ ...ok, username: '  ' })).toContain('username_invalid')
  })
  it('rejects a password shorter than 10 chars', () => {
    expect(validateRegistration({ ...ok, password: 'short' })).toContain('password_too_short')
  })
  it('rejects a missing companion pubkey', () => {
    expect(validateRegistration({ ...ok, companionPubkey: '' })).toContain('companion_required')
  })
})

describe('body builders', () => {
  it('buildRegisterBody omits email when blank and maps companion key', () => {
    expect(buildRegisterBody({ username: 'a', password: 'p', email: '', companionPubkey: 'ff' }))
      .toEqual({ username: 'a', password: 'p', companion_pubkey: 'ff' })
  })
  it('buildRegisterBody includes email when present', () => {
    expect(buildRegisterBody({ username: 'a', password: 'p', email: 'x@y.z', companionPubkey: 'ff' }))
      .toEqual({ username: 'a', password: 'p', email: 'x@y.z', companion_pubkey: 'ff' })
  })
  it('buildLoginBody carries remember as a boolean', () => {
    expect(buildLoginBody({ username: 'a', password: 'p', remember: true }))
      .toEqual({ username: 'a', password: 'p', remember: true })
  })
  it('buildLinkBody wraps the pubkey', () => {
    expect(buildLinkBody('ff')).toEqual({ companion_pubkey: 'ff' })
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('fetchMe', () => {
  it('returns the parsed me-shape on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ role: 'hunter', username: 'alice', companions: ['ff'] }) })))
    expect(await fetchMe()).toEqual({ role: 'hunter', username: 'alice', companions: ['ff'] })
  })
  it('returns offline guest on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await fetchMe()).toEqual({ role: 'guest', offline: true })
  })
})

describe('postAuth', () => {
  it('returns ok+status+data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ role: 'hunter', username: 'alice' }) })))
    const r = await postAuth('/api/auth/login', { username: 'alice' })
    expect(r).toEqual({ ok: true, status: 200, data: { role: 'hunter', username: 'alice' } })
  })
  it('tolerates an empty 204 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204,
      json: async () => { throw new Error('no body') } })))
    const r = await postAuth('/api/auth/logout', {})
    expect(r).toEqual({ ok: true, status: 204, data: {} })
  })
  it('returns a network sentinel on fetch throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await postAuth('/api/auth/login', {})).toEqual({ ok: false, status: 0, data: { error: 'network' } })
  })
})

describe('accountDisplayState', () => {
  it('guest offers login and register', () => {
    const s = accountDisplayState({ role: 'guest' }, '')
    expect(s).toMatchObject({ loggedIn: false, showLogin: true, showRegister: true, showLogout: false, showLink: false })
    expect(s.label).toBe('Not logged in')
  })
  it('authed shows username, role and logout', () => {
    const s = accountDisplayState({ role: 'hunter', username: 'alice', companions: ['ff'] }, 'ff')
    expect(s).toMatchObject({ loggedIn: true, showLogin: false, showRegister: false, showLogout: true, showLink: false })
    expect(s.label).toBe('alice (hunter)')
  })
  it('offers to link a connected but unlinked companion', () => {
    const s = accountDisplayState({ role: 'hunter', username: 'alice', companions: ['ff'] }, 'aa')
    expect(s.showLink).toBe(true)
  })
  it('does not offer link when no companion connected', () => {
    const s = accountDisplayState({ role: 'hunter', username: 'alice', companions: [] }, '')
    expect(s.showLink).toBe(false)
  })
})

describe('offline resilience', () => {
  it('offline me yields a guest display state, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const me = await fetchMe()
    expect(me.role).toBe('guest')
    const s = accountDisplayState(me, '')
    expect(s.loggedIn).toBe(false)
    expect(s.showLogin).toBe(true)
  })
})
