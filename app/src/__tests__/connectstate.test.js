import { describe, it, expect } from 'vitest'
import { connectButton, connectFailureMessage, CONNECT_PHASES } from '../connectstate.js'

// The four states the connect button has always had, previously written by
// three different functions (#433). Each case names a moment a hunter is
// actually in, and asserts the whole rendering — a label without its disabled
// flag is how "Connecting…" became clickable.
describe('connectButton', () => {
  it('offers a way in when nothing is connected', () => {
    expect(connectButton('idle')).toEqual({ label: 'Connect', disabled: false, connected: false })
  })

  it('refuses a second tap while a connection is being made', () => {
    expect(connectButton('connecting')).toEqual({ label: 'Connecting…', disabled: true, connected: false })
  })

  it('offers the way out once the link is up', () => {
    expect(connectButton('connected')).toEqual({ label: 'Disconnect', disabled: false, connected: true })
  })

  // The distinction #433 turns on: a failed attempt is still disconnected, so
  // it must not read 'Disconnect' -- but it must not read a bare 'Connect'
  // either, or a hunter cannot tell a fresh start from an attempt that just
  // died. This is the case the old `silent` flag existed to protect.
  it('says the last attempt failed, without pretending to be connected', () => {
    expect(connectButton('failed')).toEqual({ label: 'Connect (retry)', disabled: false, connected: false })
  })

  // A spontaneous BLE drop is the bug this issue is about: state goes to
  // disconnected without any code path having written a label. Whatever an
  // unknown phase is, it can never leave a disconnected hunter looking
  // connected.
  it('falls back to a usable Connect for an unknown phase', () => {
    for (const phase of ['', undefined, null, 'nonsense']) {
      expect(connectButton(phase), String(phase)).toEqual({ label: 'Connect', disabled: false, connected: false })
    }
  })

  it('names every phase it renders, so a caller cannot invent one', () => {
    for (const phase of CONNECT_PHASES) {
      expect(typeof connectButton(phase).label, phase).toBe('string')
    }
  })
})

// #539: the failure copy names the cause. Web Bluetooth reports the cause in
// the DOMException name; the message a hunter sees must carry it, because
// "Could not connect" gives nothing to act on (the reproduced case: the
// companion already claimed by another tab looks identical to out-of-range).
describe('connectFailureMessage', () => {
  const msg = (err) => connectFailureMessage(err)

  it('says when no companion was picked in the chooser', () => {
    expect(msg({ name: 'NotFoundError', message: 'User cancelled the requestDevice() chooser.' }))
      .toBe('No companion was picked. Tap Connect to choose one.')
  })

  it('names the another-tab/out-of-range case for a GATT failure', () => {
    expect(msg({ name: 'NetworkError', message: 'Connection failed for unknown reason.' }))
      .toBe('The companion did not answer. If another tab or app holds its connection, close that one; then tap Connect to retry.')
  })

  it('says when the browser blocked Bluetooth for the site', () => {
    expect(msg({ name: 'SecurityError', message: 'Access denied.' }))
      .toBe('The browser blocked Bluetooth for this site. Allow Bluetooth in the site settings, then tap Connect to retry.')
  })

  it('carries an unknown error message through rather than hiding it', () => {
    expect(msg(new Error('Web Bluetooth not available (use Android Chrome)')))
      .toBe('Could not connect: Web Bluetooth not available (use Android Chrome). Tap Connect to retry.')
  })

  it('falls back to the plain line when there is nothing to name', () => {
    expect(msg(null)).toBe('Could not connect. Tap Connect to retry.')
    expect(msg({})).toBe('Could not connect. Tap Connect to retry.')
    expect(msg({ message: '   ' })).toBe('Could not connect. Tap Connect to retry.')
  })
})
