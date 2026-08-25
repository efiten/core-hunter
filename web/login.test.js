import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loginErrorMessage } from './login.js'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

describe('loginErrorMessage', () => {
  it('names wrong credentials for 401, matching the app', () => {
    expect(loginErrorMessage(401)).toBe('Wrong username or password.')
  })
  it('names a disabled account for 403, matching the app', () => {
    expect(loginErrorMessage(403)).toBe('This account is disabled.')
  })
  it('names rate-limiting for 429, matching the app', () => {
    expect(loginErrorMessage(429)).toBe('Too many attempts — wait a minute.')
  })
  it('falls back to a generic connection message for any other status (including 0 for network failure)', () => {
    expect(loginErrorMessage(500)).toBe('Login failed — check your connection.')
    expect(loginErrorMessage(0)).toBe('Login failed — check your connection.')
  })
})

// #490: the modal was login-only, so someone who has never had an account hit a
// dead end here -- reported by a visitor who went looking for a sign-up page and
// found none. The map itself cannot register anyone: /api/auth/register requires
// a companion_pubkey (httpapi/auth.go), which only the RX webapp has. So the
// card carries the one thing it can: where accounts are actually made.
describe('login card', () => {
  const form = (() => {
    const start = html.indexOf('id="login-form"')
    return html.slice(start, html.indexOf('</form>', start))
  })()

  it('sends a visitor with no account to the surface that can create one', () => {
    expect(form).toMatch(/no account/i)
    expect(form).toContain('https://rx.mesh-hunter.eu')
  })

  it('names the companion, which is what makes registering app-only', () => {
    expect(form).toMatch(/companion/i)
  })
})
