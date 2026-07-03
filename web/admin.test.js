import { describe, it, expect } from 'vitest'
import { shapeUsers, shapeAudit, escapeHtml } from './admin.js'

describe('escapeHtml', () => {
  it('neutralizes a malicious username so it renders as text, not markup', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const out = escapeHtml(payload)
    expect(out).not.toContain('<img')
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes quotes so attribute-context injection is also neutralized', () => {
    expect(escapeHtml(`"><script>1</script>`)).toBe('&quot;&gt;&lt;script&gt;1&lt;/script&gt;')
  })

  it('passes through plain strings unchanged', () => {
    expect(escapeHtml('alice')).toBe('alice')
  })
})

describe('shapeUsers', () => {
  it('flattens companions to a count and formats last login', () => {
    const rows = shapeUsers({ users: [
      { id: 1, username: 'alice', email: 'a@x', role: 'admin', status: 'active',
        companions: ['aa', 'bb'], last_login_at: '2026-07-03T09:00:00Z' },
      { id: 2, username: 'bob', email: null, role: 'hunter', status: 'active',
        companions: [], last_login_at: null },
    ] })
    expect(rows[0]).toMatchObject({ id: 1, username: 'alice', companions: 2 })
    expect(rows[1].companions).toBe(0)
    expect(rows[1].lastLogin).toBe('—')
    expect(rows[1].email).toBe('')
  })
})

describe('shapeAudit', () => {
  it('formats actor → action → target', () => {
    const rows = shapeAudit({ events: [
      { id: 9, at: '2026-07-03T10:00:00Z', actor: 'alice', action: 'role_change', target: 'bob→member', ip: '1.2.3.4', details: '' },
    ] })
    expect(rows[0].line).toBe('alice → role_change → bob→member (1.2.3.4)')
  })
})
