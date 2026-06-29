import { describe, it, expect } from 'vitest'
import { feedItems, relTime } from '../feed.js'

const rec = (o) => ({ sender_kind: 'channel_name', sender_id: 'Spammer', rx_at: '2026-06-29T10:00:00Z', ...o })

describe('feedItems', () => {
  it('keeps only channel_name + advert_pubkey kinds', () => {
    const out = feedItems([
      rec({ sender_kind: 'channel_name', sender_id: 'A' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: 'B' }),
      rec({ sender_kind: 'direct_hash', sender_id: 'C' }),
      rec({ sender_kind: null, sender_id: null }),
    ], {})
    expect(out.map((r) => r.sender_id)).toEqual(['A', 'B'])
  })
  it('drops ignored sender ids (case-insensitive)', () => {
    const out = feedItems([rec({ sender_id: 'AA' }), rec({ sender_id: 'bb' })], { ignore: new Set(['aa']) })
    expect(out.map((r) => r.sender_id)).toEqual(['bb'])
  })
  it('sorts newest-first and respects limit', () => {
    const out = feedItems([
      rec({ sender_id: 'old', rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_id: 'new', rx_at: '2026-06-29T10:05:00Z' }),
      rec({ sender_id: 'mid', rx_at: '2026-06-29T10:02:00Z' }),
    ], { limit: 2 })
    expect(out.map((r) => r.sender_id)).toEqual(['new', 'mid'])
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-06-29T10:05:00Z')
  it('formats s/m/h', () => {
    expect(relTime('2026-06-29T10:04:30Z', now)).toBe('30s')
    expect(relTime('2026-06-29T10:02:00Z', now)).toBe('3m')
    expect(relTime('2026-06-29T08:05:00Z', now)).toBe('2h')
  })
  it('returns — for missing or unparseable rxAt', () => {
    expect(relTime(null, now)).toBe('—')
    expect(relTime(undefined, now)).toBe('—')
    expect(relTime('not-a-date', now)).toBe('—')
  })
})
