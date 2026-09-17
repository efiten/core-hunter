import { describe, it, expect } from 'vitest'
import { sinceLabel } from '../elapsed.js'

describe('sinceLabel — time since last packet', () => {
  // #618: the HUD's age slot stays empty before the first reception, rather
  // than holding a placeholder dash.
  it('shows nothing when no packet has been heard', () => {
    expect(sinceLabel(1000, null)).toBe('')
    expect(sinceLabel(1000, undefined)).toBe('')
  })

  it('shows whole seconds under a minute', () => {
    expect(sinceLabel(5_000, 5_000)).toBe('0s')
    expect(sinceLabel(8_400, 5_000)).toBe('3s') // floors fractional seconds
    expect(sinceLabel(59_000, 0)).toBe('59s')
  })

  it('shows minutes and seconds under an hour', () => {
    expect(sinceLabel(60_000, 0)).toBe('1m 0s')
    expect(sinceLabel(90_000, 0)).toBe('1m 30s')
    expect(sinceLabel(3_599_000, 0)).toBe('59m 59s')
  })

  it('shows hours and minutes from an hour up', () => {
    expect(sinceLabel(3_600_000, 0)).toBe('1h 0m')
    expect(sinceLabel(3_600_000 + 90_000, 0)).toBe('1h 1m')
  })

  it('clamps a future last-seen time to 0s instead of going negative', () => {
    expect(sinceLabel(1_000, 5_000)).toBe('0s')
  })
})
