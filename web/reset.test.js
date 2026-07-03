import { describe, it, expect } from 'vitest'
import { parseResetToken, validateNewPassword, buildResetBody } from './reset.js'

describe('parseResetToken', () => {
  it('extracts the token from the query', () => {
    expect(parseResetToken('?token=abc123')).toBe('abc123')
  })
  it('returns null when absent', () => {
    expect(parseResetToken('')).toBeNull()
    expect(parseResetToken('?x=1')).toBeNull()
  })
})

describe('validateNewPassword', () => {
  it('accepts passwords of 10 or more characters', () => {
    expect(validateNewPassword('1234567890')).toBe(true)
    expect(validateNewPassword('a very long password')).toBe(true)
  })
  it('rejects passwords shorter than 10 characters', () => {
    expect(validateNewPassword('short1')).toBe(false)
    expect(validateNewPassword('')).toBe(false)
  })
})

describe('buildResetBody', () => {
  it('builds the request body from a token and password', () => {
    expect(buildResetBody('abc123', 'longenoughpw')).toEqual({ token: 'abc123', new_password: 'longenoughpw' })
  })
})
