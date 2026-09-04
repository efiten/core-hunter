import { describe, it, expect } from 'vitest'
import { buildSelfAdvertFrame, announceThisCycle } from '../announce.js'

// The frame is CMD_SEND_SELF_ADVERT (7) with the route byte at 0, which the
// firmware reads as zero-hop (examples/companion_radio/MyMesh.cpp:1258, "1 =
// flood, 0 = zero hop"). A 1 there floods the mesh, so the byte is the test.
describe('buildSelfAdvertFrame', () => {
  it('asks the companion for one zero-hop advert, never a flood', () => {
    expect([...buildSelfAdvertFrame()]).toEqual([7, 0])
  })
})

// The advert rides the auto-ping cycle, and only while a selected target is a
// companion: that is the node that has to hear us before it can answer. With
// the setting off, or nothing selected that needs it, no cycle carries one.
describe('announceThisCycle', () => {
  it('is true only with the setting on, a companion connected, and a companion target', () => {
    expect(announceThisCycle({ shareName: true, connected: true, companionTargets: 1 })).toBe(true)
    expect(announceThisCycle({ shareName: false, connected: true, companionTargets: 1 })).toBe(false)
    expect(announceThisCycle({ shareName: true, connected: false, companionTargets: 1 })).toBe(false)
    expect(announceThisCycle({ shareName: true, connected: true, companionTargets: 0 })).toBe(false)
  })
  // Off by default means a missing or malformed value must read as off.
  it('treats anything but an explicit true as off', () => {
    for (const v of [undefined, null, 1, '1', 'true']) expect(announceThisCycle({ shareName: v, connected: true, companionTargets: 2 }), String(v)).toBe(false)
  })
})
