import { describe, it, expect } from 'vitest'
import { mqttShouldRun, mqttAction } from '../mqttlifecycle.js'

describe('mqttShouldRun', () => {
  const ok = { configured: true, paused: false, rxPubkey: 'aabb' }

  it('runs whenever there is somewhere to send, permission, and an identity', () => {
    expect(mqttShouldRun(ok)).toBe(true)
  })

  it('does NOT require the radio to be connected', () => {
    // The whole point. Receptions go to IndexedDB first and the drain
    // publishes from there, so a parked hunter with a full queue and the
    // companion unplugged is exactly who needs the backlog to go out.
    // BLE state is not an input here at all -- there is nothing to pass.
    expect(Object.keys(ok)).not.toContain('connected')
    expect(mqttShouldRun(ok)).toBe(true)
  })

  it('stops for a pause, which is a choice the hunter made', () => {
    expect(mqttShouldRun({ ...ok, paused: true })).toBe(false)
  })

  it('stops with no broker configured and no identity to publish under', () => {
    expect(mqttShouldRun({ ...ok, configured: false })).toBe(false)
    expect(mqttShouldRun({ ...ok, rxPubkey: '' })).toBe(false)
  })

  it('answers false rather than throwing for whatever it is handed', () => {
    for (const junk of [undefined, {}, null]) expect(mqttShouldRun(junk ?? undefined)).toBe(false)
  })
})

describe('mqttAction', () => {
  it('creates a publisher when there should be one and there is not', () => {
    // The recovery that never existed: nothing but a BLE connect ever made one.
    expect(mqttAction(true, false)).toBe('connect')
  })

  it('leaves a live client alone, even while its socket is down', () => {
    // mqtt.js reconnects on its own every 4 s. Re-creating a client that is
    // merely offline throws away its backoff and its inflight queue, which
    // turns a blip into a loop.
    expect(mqttAction(true, true)).toBe('none')
  })

  it('tears one down when it should not be running', () => {
    expect(mqttAction(false, true)).toBe('end')
  })

  it('does nothing when there is nothing to do', () => {
    expect(mqttAction(false, false)).toBe('none')
  })
})
