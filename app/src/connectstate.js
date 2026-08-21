// What the connect button says, and whether it can be pressed (#433).
//
// This was three functions writing one label. connectAll() set 'Connecting…'
// and 'Connect (retry)', disconnectAll() restored 'Connect' behind a `silent`
// flag, and refreshConnState() set 'Disconnect' — but only in its connected
// branch. Its disconnected branch swapped CSS classes and left the text alone,
// deliberately, so it could not clobber the other two writers.
//
// The gap that left: a spontaneous BLE drop (companion out of range, radio off,
// battery flat) reaches none of those writers. state.connected goes false, the
// sheet then reads "Not connected", and the button still reads "Disconnect" —
// a disconnected hunter with no visible way back. Pressing it did connect,
// since the click handler branches on state, but nothing on screen said so.
//
// So the label stops being something three callers write and becomes something
// one phase describes. Callers move the phase; this decides how it looks.

// 'failed' is a distinct phase, not a flavour of 'idle': after a failed attempt
// the button must not read 'Disconnect' (nothing is connected) nor a bare
// 'Connect' (a hunter cannot tell a fresh start from an attempt that just
// died). It is what the old `silent` flag was protecting.
export const CONNECT_PHASES = ['idle', 'connecting', 'connected', 'failed']

const RENDERING = {
  idle: { label: 'Connect', disabled: false, connected: false },
  connecting: { label: 'Connecting…', disabled: true, connected: false },
  connected: { label: 'Disconnect', disabled: false, connected: true },
  failed: { label: 'Connect (retry)', disabled: false, connected: false },
}

// connectButton renders a phase. An unrecognised phase falls back to 'idle'
// rather than to the last thing written: the whole point is that a state
// nobody wrote a label for must still leave a usable Connect on screen, not a
// stale 'Disconnect'.
export function connectButton(phase) {
  return RENDERING[phase] || RENDERING.idle
}
