// What the HUD says about receptions that have not reached the map yet (#454).
//
// The MQTT dot answers "is the socket open". That is not the same question as
// "are my receptions getting through", and on 2026-08-24 the difference was a
// whole hunt: the app captured 3,078 receptions and the median one reached the
// server 97 minutes later, with nothing at all sent for the first 71. The dot
// was lit throughout. A hunter driving a search pattern was working from a map
// an hour and a half stale and had no way to tell.
//
// So the backlog gets a number. Pure decision here, DOM in app.js.

// Below this a backlog is just the drain doing its job between 5 s ticks --
// a burst of receptions is queued and gone again before anyone could read it.
// Showing "3 queued" every few seconds would train people to ignore the line
// that matters.
export const BACKLOG_NOTICE_MIN = 25

// Above this the backlog is not a hiccup: at the drain's batch of 100 per pass
// it is minutes of catching up, and on a hunt that is the map lying to you.
export const BACKLOG_ALARM = 250

export function backlogState(pending, { connected = true, paused = false } = {}) {
  const n = Number.isFinite(pending) ? Math.max(0, Math.trunc(pending)) : 0
  // Paused is a choice the hunter made, so it is stated rather than warned
  // about -- but the number still shows, because "I paused it" and "I paused it
  // and 4,000 receptions are waiting" are different situations.
  if (paused) return { show: n > 0, level: 'paused', pending: n, text: `${n.toLocaleString('en')} queued · MQTT paused` }
  // Disconnected with nothing waiting is not worth a line: the drain has
  // nothing to do either way.
  if (!connected) return { show: n > 0, level: n >= BACKLOG_ALARM ? 'alarm' : 'warn', pending: n, text: `${n.toLocaleString('en')} queued · not connected` }
  if (n < BACKLOG_NOTICE_MIN) return { show: false, level: 'ok', pending: n, text: '' }
  return {
    show: true,
    level: n >= BACKLOG_ALARM ? 'alarm' : 'warn',
    pending: n,
    text: `${n.toLocaleString('en')} queued · not on the map yet`,
  }
}
