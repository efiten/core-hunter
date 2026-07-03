import { describe, it, expect } from 'vitest'
import { validateRegistration, buildRegisterBody, buildLoginBody, buildLinkBody } from '../auth.js'

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
