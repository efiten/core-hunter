import { describe, it, expect } from 'vitest'
import { floatModel, floatSupported } from '../floatreadout.js'

const rec = { sender_kind: 'advert_pubkey', sender_id: 'ab12cd34ef56', sender_label: 'alpha', rssi: -85, snr: 8.5 }
const base = { rec, sinceText: '12s', mode: 'filtered', hidden: 0, ble: true, mqtt: true }

describe('floatModel — what the float readout draws', () => {
  it('carries the reception the way the HUD shows it', () => {
    const m = floatModel(base)
    expect(m.rssi).toBe('-85')
    expect(m.snr).toBe('SNR 8.5 dB')
    expect(m.since).toBe('12s')
    expect(m.who).toBe('alpha')
    expect(m.tier).toBe('warm')
  })
  // The same refusal the HUD makes: a 1-byte hash is an id, never a name.
  it('goes through senderReadout, so a hash id stays marked as one', () => {
    const m = floatModel({ ...base, rec: { ...rec, sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' } })
    expect(m.who).toBe('#4a')
  })
  it('draws placeholders before the first reception', () => {
    const m = floatModel({ ...base, rec: null, sinceText: '—' })
    expect(m.rssi).toBe('—')
    expect(m.snr).toBe('SNR —')
    expect(m.who).toBe('—')
    expect(m.tier).toBe('none')
  })
  it('names the stand, and marks the eye only while filtered mode hid something', () => {
    expect(floatModel(base).stand).toBe('FILTERED')
    expect(floatModel(base).eye).toBe(false)
    expect(floatModel({ ...base, hidden: 2 }).eye).toBe(true)
    expect(floatModel({ ...base, mode: 'all', hidden: 2 }).stand).toBe('ALL')
    expect(floatModel({ ...base, mode: 'all', hidden: 2 }).eye).toBe(false)
  })
  // A frozen number in a floating window reads as "quiet", so the window has
  // to say when the radio is gone. The two dots are the topbar's, verbatim.
  it('reports the link state, and says Disconnected when BLE is gone', () => {
    expect(floatModel(base).dots).toEqual({ ble: true, mqtt: true })
    expect(floatModel(base).warning).toBe('')
    const m = floatModel({ ...base, ble: false, mqtt: false })
    expect(m.dots).toEqual({ ble: false, mqtt: false })
    expect(m.warning).toBe('Disconnected')
  })
  // The attenuator offset shifts the tier the same way the map and the HUD
  // shift it, so the window's colour agrees with both.
  it('applies the plot offset to the tier', () => {
    expect(floatModel({ ...base, offsetDb: 20 }).tier).toBe('hot')
  })
})

describe('floatSupported', () => {
  const win = (over) => ({
    document: { pictureInPictureEnabled: true },
    HTMLCanvasElement: { prototype: { captureStream() {} } },
    HTMLVideoElement: { prototype: { requestFullscreen() {}, requestPictureInPicture() {} } },
    ...over,
  })
  it('is true when a canvas can stream and a video can go fullscreen or float', () => {
    expect(floatSupported(win())).toBe(true)
  })
  it('is false without canvas capture', () => {
    expect(floatSupported(win({ HTMLCanvasElement: { prototype: {} } }))).toBe(false)
  })
  // iOS Safari has neither video PiP from a stream nor element fullscreen on
  // a video, but webkitEnterFullscreen: still a way to show the readout big.
  it('accepts webkitEnterFullscreen as the fullscreen path', () => {
    expect(floatSupported(win({ HTMLVideoElement: { prototype: { webkitEnterFullscreen() {} } } }))).toBe(true)
  })
  it('is false when the video has no way to leave the page', () => {
    expect(floatSupported(win({ HTMLVideoElement: { prototype: {} } }))).toBe(false)
  })
  it('is false with no window at all', () => {
    expect(floatSupported(undefined)).toBe(false)
  })
})
