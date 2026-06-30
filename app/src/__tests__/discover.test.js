import { describe, it, expect } from 'vitest'
import { buildDiscoverFrame } from '../discover.js'
describe('buildDiscoverFrame', () => {
  it('builds [0x37, 0x81, 0xff, ...tag] (7 bytes)', () => {
    const f = buildDiscoverFrame(new Uint8Array([1, 2, 3, 4]))
    expect(Array.from(f)).toEqual([0x37, 0x81, 0xff, 1, 2, 3, 4])
    expect(f.length).toBe(7)
  })
})
