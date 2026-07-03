import { describe, it, expect } from 'vitest'
import { hunterOptionLabel } from './filters.js'

describe('hunterOptionLabel', () => {
  it('uses the pseudonym name for guests', () => {
    expect(hunterOptionLabel({ hunter_pubkey: 'h3', hunter_name: 'Hunter 3', count: 42 }))
      .toBe('Hunter 3 (42)')
  })
  it('falls back to a pubkey prefix when unnamed', () => {
    expect(hunterOptionLabel({ hunter_pubkey: 'abcdef0123456789', hunter_name: '', count: 5 }))
      .toBe('abcdef01 (5)')
  })
})
