import { describe, it, expect } from 'vitest'
import { resolveState, snapshotToQuery } from './urlstate.js'

describe('resolveState', () => {
  const keys = ['theme', 'mode', 'sender']

  it('takes the URL value when present (a shared link wins over the stored value)', () => {
    const stored = { theme: 'dark', mode: 'points' }
    const url = new URLSearchParams('theme=light&mode=hex')
    expect(resolveState(keys, stored, url)).toEqual({ theme: 'light', mode: 'hex' })
  })

  it('falls back to the stored value when the URL omits the key', () => {
    const stored = { theme: 'light', sender: 'ab12' }
    const url = new URLSearchParams('mode=both')
    expect(resolveState(keys, stored, url)).toEqual({ theme: 'light', mode: 'both', sender: 'ab12' })
  })

  it('omits keys absent from both sources', () => {
    expect(resolveState(keys, {}, new URLSearchParams(''))).toEqual({})
  })

  it('drops empty-string values from either source', () => {
    const stored = { sender: '' }
    const url = new URLSearchParams('theme=')
    expect(resolveState(keys, stored, url)).toEqual({})
  })

  it('lets an empty URL value fall through to a non-empty stored value', () => {
    const stored = { theme: 'light' }
    const url = new URLSearchParams('theme=')
    expect(resolveState(keys, stored, url)).toEqual({ theme: 'light' })
  })
})

describe('snapshotToQuery', () => {
  it('serializes a state object to a query string', () => {
    expect(snapshotToQuery({ theme: 'light', z: '14' })).toBe('theme=light&z=14')
  })

  it('drops null/undefined/empty values', () => {
    expect(snapshotToQuery({ theme: 'light', sender: '', mode: null, z: undefined })).toBe('theme=light')
  })

  it('is empty for an empty snapshot', () => {
    expect(snapshotToQuery({})).toBe('')
  })

  it('url-encodes values (e.g. ISO timestamps with colons)', () => {
    expect(snapshotToQuery({ from: '2026-07-02T00:00' })).toBe('from=2026-07-02T00%3A00')
  })
})
