// The node-positions FAB's three stops (#603): off, the ▲/● layer (#197),
// and that layer plus every repeater's reach (coverage.js). Cycled like the
// sound FAB, with the ring showing the stop (fabring.js); the reach is the
// layer's second on-state, since the stars leave from the ▲ it draws.
export const NODEPOS_MODES = ['off', 'positions', 'reach']

// Rail label grammar (#539): "Name: state".
export const NODEPOS_LABELS = {
  off: 'Node positions: off',
  positions: 'Node positions: advertised positions',
  reach: 'Node positions: positions and reach',
}

// An unknown mode counts as "before the first", as nextSoundMode does, so a
// corrupt stored value lands on positions at the first tap.
export function nextNodePosMode(m) {
  const i = NODEPOS_MODES.indexOf(m)
  return NODEPOS_MODES[(Math.max(i, 0) + 1) % NODEPOS_MODES.length]
}

export function parseNodePosMode(v) {
  return NODEPOS_MODES.includes(v) ? v : 'off'
}
