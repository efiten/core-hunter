import { describe, it, expect } from 'vitest'
import { openStore } from '../store.js'

describe('openStore', () => {
  it('dedups by pubkey and updates on upsert', () => {
    const s = openStore(':memory:')
    s.upsert({ pubkey: 'aabbccdd', name: 'One', lat: 1, lon: 2 })
    s.upsert({ pubkey: 'aabbccdd', name: 'Two', lat: null, lon: null }) // same pubkey → update
    s.upsert({ pubkey: 'aabbeeff', name: 'Other', lat: null, lon: null })
    const cache = s.loadCache()
    expect(cache.size).toBe(2)
    expect(cache.get('aabbccdd')).toEqual({ name: 'Two', lat: null, lon: null })
    s.close()
  })

  it('count returns the number of stored nodes', () => {
    const s = openStore(':memory:')
    expect(s.count()).toBe(0)
    s.upsert({ pubkey: 'aabbccdd', name: 'One', lat: null, lon: null })
    s.upsert({ pubkey: 'aabbccdd', name: 'One again', lat: null, lon: null }) // same pubkey
    s.upsert({ pubkey: 'aabbeeff', name: 'Two', lat: null, lon: null })
    expect(s.count()).toBe(2)
    s.close()
  })

  it('resolvePrefix returns unique, ambiguous, and miss correctly', () => {
    const s = openStore(':memory:')
    s.upsert({ pubkey: 'aabbccdd', name: 'One', lat: null, lon: null })
    s.upsert({ pubkey: 'aabbeeff', name: 'Two', lat: null, lon: null })
    expect(s.resolvePrefix('aabbcc')).toHaveLength(1)         // unique
    expect(s.resolvePrefix('aabbcc')[0].name).toBe('One')
    expect(s.resolvePrefix('aabb')).toHaveLength(2)           // ambiguous
    expect(s.resolvePrefix('ffff')).toHaveLength(0)           // miss
    s.close()
  })
})
