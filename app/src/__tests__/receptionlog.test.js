import { describe, it, expect } from 'vitest'
import { rxView, rxActiveIndex, rxFade, RX_FADE_FLOOR, rxLineHeight, senderText, lineMeta } from '../receptionlog.js'

const rec = (o) => ({ id: 1, rx_at: '2026-06-29T10:00:00Z', ...o })

// The ticker prints sender_label straight into the row. meshpacket.js carries
// a 1-byte hash AS that label, so without a guard "77" appears in the same
// place, same style, as a resolved name -- the exact confusion hudsender.js
// was given the # mark to prevent.
describe('senderText — an id is never dressed as a name', () => {
  it('marks a 1-byte path hash', () => {
    expect(senderText({ sender_kind: 'path_hash', sender_id: '77', sender_label: '77' })).toBe('#77')
  })
  it('marks a 1-byte direct hash', () => {
    expect(senderText({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: '4a' })).toBe('#4a')
  })
  it('ignores a hash-kind label even when it looks like a real name', () => {
    expect(senderText({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: 'Repeater-Zuid' })).toBe('#4a')
  })
  it('prints a resolved name for every other kind', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: 'repeater-3' })).toBe('repeater-3')
  })
  it('falls back to the id, then to a dash', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: '' })).toBe('a1b2f3')
    expect(senderText({ sender_kind: 'relay', sender_id: null, sender_label: null })).toBe('—')
  })
})

// #482: a trace reply we provoked carries the SNR the node we pinged heard US
// at. The meta cell is where a reception explains itself (text > channel >
// type label), and for the one row that has it, the reciprocal reading says
// more than the bare word "Trace" — so it takes the type label's slot, and
// only that slot.
describe('lineMeta — the reciprocal SNR on a trace reply (#482)', () => {
  it('shows what the node heard us at, in the HUD\'s SNR format', () => {
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: -11.5 })).toBe('heard us at -11.5 dB')
    // The firmware unit is a quarter dB; one decimal matches #hud-snr.
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: -4.25 })).toBe('heard us at -4.3 dB')
  })
  it('shows a 0 dB reading rather than dropping it', () => {
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: 0 })).toBe('heard us at 0.0 dB')
  })
  it('leaves a trace nobody asked for as its type label', () => {
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: null })).toBe('Trace')
    expect(lineMeta({ packet_type: 'Trace' })).toBe('Trace')
  })
  it('never outranks a decrypted text or a channel name', () => {
    // No packet carries both today (a trace has no text); pinned so a field
    // shuffle cannot silently demote the message text below a number.
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: -4, _text: 'hoi' })).toBe('“hoi”')
    expect(lineMeta({ packet_type: 'Trace', heard_us_snr: -4, channel_name: 'public' })).toBe('public')
  })
})

describe('rxView — source select, ascending by rx_at, recent cap', () => {
  const filtered = [rec({ id: 1, rx_at: '2026-06-29T10:00:00Z' }), rec({ id: 2, rx_at: '2026-06-29T10:02:00Z' })]
  const all = [...filtered, rec({ id: 3, rx_at: '2026-06-29T10:01:00Z' })]

  it('filtered mode returns the filtered set, all mode the full set', () => {
    expect(rxView(filtered, all, 'filtered').map((r) => r.id)).toEqual([1, 2])
    expect(rxView(filtered, all, 'all').map((r) => r.id).sort()).toEqual([1, 2, 3])
  })
  it('sorts ascending by rx_at (newest last)', () => {
    expect(rxView(filtered, all, 'all').map((r) => r.id)).toEqual([1, 3, 2])
  })
  it('caps to the most recent N, dropping the oldest', () => {
    const many = Array.from({ length: 10 }, (_, i) => rec({ id: i, rx_at: `2026-06-29T10:0${i}:00Z` }))
    const out = rxView(many, many, 'filtered', 3)
    expect(out.map((r) => r.id)).toEqual([7, 8, 9])
  })
  it('handles empty / missing input', () => {
    expect(rxView([], [], 'filtered')).toEqual([])
    expect(rxView(undefined, undefined, 'all')).toEqual([])
  })
})

describe('rxActiveIndex — playhead index from scroll, clamped', () => {
  it('rounds scrollTop/lineH', () => {
    expect(rxActiveIndex(0, 20, 10)).toBe(0)
    expect(rxActiveIndex(58, 20, 10)).toBe(3)
    expect(rxActiveIndex(50, 20, 10)).toBe(3) // 2.5 rounds to 3 (banker-free Math.round)
  })
  it('clamps to [0, count-1] and returns -1 when empty', () => {
    expect(rxActiveIndex(-40, 20, 10)).toBe(0)
    expect(rxActiveIndex(9999, 20, 10)).toBe(9)
    expect(rxActiveIndex(0, 20, 0)).toBe(-1)
  })
})

describe('rxFade, playhead-relative opacity', () => {
  it('is 1 on the lane', () => { expect(rxFade(0)).toBe(1) })

  // Older rows fade across the lanes there are above the playhead, and stop at
  // a floor rather than at nothing (#560): fading to zero on the card's own top
  // lane is what made a ten-lane card show six rows and four invisible ones.
  it('fades older rows across the span it is given, down to the floor', () => {
    expect(rxFade(-9, 9)).toBe(RX_FADE_FLOOR)
    expect(rxFade(-1, 9)).toBeGreaterThan(rxFade(-8, 9))
    expect(rxFade(-8, 9)).toBeGreaterThan(RX_FADE_FLOOR)
  })

  it('never drops a visible row to nothing, at any card size', () => {
    for (const above of [1, 2, 4, 9]) {
      for (let d = -above; d <= -1; d++) {
        expect(rxFade(d, above), `d=${d} of ${above}`).toBeGreaterThanOrEqual(RX_FADE_FLOOR)
      }
    }
  })

  // Newer rows still fall off faster than older ones, because the playhead has
  // fewer lanes under it than above it. They land on the floor rather than on
  // nothing, which is the change: since #560 those lanes hold receptions
  // instead of being blank padding, and the newest one lives on the last of
  // them.
  it('fades newer rows faster than older ones, and stops at the floor', () => {
    expect(rxFade(1, 6, 3)).toBeLessThan(rxFade(-1, 6, 3))
    expect(rxFade(3, 6, 3), 'the newest row on a full card').toBe(RX_FADE_FLOOR)
    expect(rxFade(5, 6, 3), 'past the card, clamped').toBe(RX_FADE_FLOOR)
  })

  it('never hides a row the card has made room for', () => {
    for (const [above, below] of [[6, 3], [3, 1], [1, 1], [0, 0]]) {
      for (let d = -above; d <= below; d++) {
        expect(rxFade(d, above, below), `d=${d} of ${above}/${below}`).toBeGreaterThanOrEqual(RX_FADE_FLOOR)
      }
    }
  })

  it('is monotonic away from the lane on both sides', () => {
    for (let d = -8; d < -1; d++) expect(rxFade(d, 9, 3)).toBeGreaterThanOrEqual(rxFade(d - 1, 9, 3))
    for (let d = 1; d < 3; d++) expect(rxFade(d, 6, 3)).toBeGreaterThanOrEqual(rxFade(d + 1, 6, 3))
  })
})

// rxLineHeight (#322): the row height now lives in CSS as --ch-rx-line-h and
// the component reads it, instead of both sides hardcoding 20 and drifting.
// The fallback matters: if the variable is missing (an old cached stylesheet,
// a test DOM with no styles) the playhead maths must still use the value the
// stylesheet ships, not 0 — a 0 here divides scrollTop by zero in
// rxActiveIndex and pins every row to the lane.
describe('rxLineHeight — row height parsed from the CSS variable', () => {
  it('parses a px value', () => {
    expect(rxLineHeight('26px')).toBe(26)
    expect(rxLineHeight(' 26px ')).toBe(26)
  })
  it('accepts a bare number and a fractional value', () => {
    expect(rxLineHeight('26')).toBe(26)
    expect(rxLineHeight('25.5px')).toBe(25.5)
  })
  it('falls back to the shipped row height when the variable is absent or unusable', () => {
    expect(rxLineHeight('')).toBe(26)
    expect(rxLineHeight(null)).toBe(26)
    expect(rxLineHeight('inherit')).toBe(26)
    expect(rxLineHeight('0px')).toBe(26)
    expect(rxLineHeight('-4px')).toBe(26)
  })
})
