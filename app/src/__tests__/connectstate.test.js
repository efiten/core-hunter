import { describe, it, expect } from 'vitest'
import { connectButton, CONNECT_PHASES } from '../connectstate.js'

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
