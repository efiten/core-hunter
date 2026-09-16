import { describe, it, expect } from 'vitest'
import { rxView, rxActiveIndex, rxFade, RX_FADE_FLOOR, rxLineHeight, senderText, senderCell, lineMeta, nextRxMode, rxStepIndex, rxLanes, rxPlayhead, rxBelow, rxMaxScroll, rxScrollLane, rxMarkerLane, rxCountLabel, outsideWindow } from '../receptionlog.js'

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
  it('prints a resolved name for every other kind, marked when the id is a short prefix (#452)', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: 'a1b2f3', sender_label: 'repeater-3' })).toBe('~repeater-3')
    expect(senderText({ sender_kind: 'discover_pubkey', sender_id: '7b0e24700e0c0d3e', sender_label: 'repeater-3' })).toBe('repeater-3')
  })
  // #452: a name on a 2-byte hash is a guess, and the line says so.
  it('marks a name resolved for a short prefix as a guess', () => {
    expect(senderText({ sender_kind: 'relay', sender_id: '2beb', sender_label: 'repeater_3_' })).toBe('~repeater_3_')
    expect(senderText({ sender_kind: 'advert_pubkey', sender_id: 'ab'.repeat(32), sender_label: 'alpha' })).toBe('alpha')
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

// The filtered/all switch is one stand shared by the ticker and the HUD
// (#555): with a filter set you look at the filtered set on both, and either
// toggle flips both. So the rule for the next stand is written once here.
describe('nextRxMode — the shared filtered/all switch', () => {
  it('swaps between the two stands', () => {
    expect(nextRxMode('filtered')).toBe('all')
    expect(nextRxMode('all')).toBe('filtered')
  })
  it('lands on filtered for anything unknown', () => {
    for (const v of ['', null, undefined, 'both']) expect(nextRxMode(v), String(v)).toBe('filtered')
  })
})

// The float readout scrubs through the same list with the PiP window's
// previous/next buttons (#555), so the step rule is pure and shared with the
// playhead: clamped to the list, and -1 on an empty one.
describe('rxStepIndex — one row back or forward on the playhead', () => {
  it('moves one row and clamps at both ends', () => {
    expect(rxStepIndex(3, -1, 10)).toBe(2)
    expect(rxStepIndex(3, 1, 10)).toBe(4)
    expect(rxStepIndex(0, -1, 10)).toBe(0)
    expect(rxStepIndex(9, 1, 10)).toBe(9)
  })
  it('is -1 on an empty list, whatever it is asked', () => {
    expect(rxStepIndex(0, 1, 0)).toBe(-1)
    expect(rxStepIndex(-1, -1, 0)).toBe(-1)
  })
  // A stale index (rows dropped by the cap since the last paint) lands on the
  // nearest real row rather than off the list.
  it('lands a stale index inside the list', () => {
    expect(rxStepIndex(25, 1, 10)).toBe(9)
    expect(rxStepIndex(-1, 1, 10)).toBe(0)
  })
})

// #451: a line showed a name OR an id, never both, so the id a name was
// resolved from vanished the moment it resolved and a mis-resolution (#452)
// had nothing on screen to check it against. The id gets its own column, cut
// with idPrefix like every other surface; a line without a name keeps the id
// in the name cell and the column empty, so the prefix never appears twice.
describe('senderCell — the id stays beside the name it resolved to', () => {
  it('puts the prefix in the id column once a name has resolved', () => {
    expect(senderCell({ sender_kind: 'relay', sender_id: 'a1b2f3c4d5e6', sender_label: 'repeater-3' })).toEqual({ id: 'a1b2f3', name: 'repeater-3' })
  })
  it('leaves the column empty while the id is the name', () => {
    expect(senderCell({ sender_kind: 'relay', sender_id: 'a1b2f3c4d5e6', sender_label: '' })).toEqual({ id: '', name: 'a1b2f3c4d5e6' })
    expect(senderCell({ sender_kind: 'relay', sender_id: null, sender_label: null })).toEqual({ id: '', name: '—' })
  })
  // meshpacket.js gives a channel_name sender its decrypted name as both id
  // and label. A label that is the id is not a name, so "Spamme" must not
  // stand beside "Spammer". The map's copy has decided it this way from the start.
  it('leaves the column empty when the label is the id itself', () => {
    expect(senderCell({ sender_kind: 'channel_name', sender_id: 'Spammer', sender_label: 'Spammer' })).toEqual({ id: '', name: 'Spammer' })
  })
  it('gives a hash id no column: the # in the name cell is all it is', () => {
    expect(senderCell({ sender_kind: 'path_hash', sender_id: '77', sender_label: '77' })).toEqual({ id: '', name: '#77' })
    expect(senderCell({ sender_kind: 'direct_hash', sender_id: '4a', sender_label: 'Repeater-Zuid' })).toEqual({ id: '', name: '#4a' })
  })
})

// #646: the list is row-bounded and the map is window-bounded, so the newest
// 200 rows can reach further back than the window the map draws. That gap used
// to be marked per row as "outside filter", which was true about the map and
// read as false about the list — in the one stand that promises to leave
// nothing out. The card now says it once: how many of the rows on show fall
// outside the window, and how far back you would have to look to include them.
describe('outsideWindow — the rows the list shows and the map cannot', () => {
  const at = (agoMs) => ({ rx_at: new Date(1_000_000_000_000 - agoMs).toISOString() })
  const NOW = 1_000_000_000_000
  const MIN = 60_000

  it('counts only the rows older than the window', () => {
    const rows = [at(50 * MIN), at(40 * MIN), at(10 * MIN), at(1 * MIN)]
    expect(outsideWindow(rows, 30 * MIN, NOW).count).toBe(2)
  })
  it('reports the oldest age among them, which is what a wider window has to cover', () => {
    const rows = [at(50 * MIN), at(40 * MIN), at(10 * MIN)]
    expect(outsideWindow(rows, 30 * MIN, NOW).oldestAgeMs).toBe(50 * MIN)
  })
  // All time has no outside: the map already draws everything retained.
  it('finds nothing outside when there is no window', () => {
    expect(outsideWindow([at(50 * MIN), at(9 * 24 * 60 * MIN)], null, NOW)).toEqual({ count: 0, oldestAgeMs: 0 })
  })
  it('finds nothing when every row is inside', () => {
    expect(outsideWindow([at(1 * MIN), at(2 * MIN)], 30 * MIN, NOW)).toEqual({ count: 0, oldestAgeMs: 0 })
  })
  // A row whose timestamp cannot be read is not evidence of anything, and must
  // not push the window wider on its own.
  it('ignores a row with an unreadable timestamp rather than counting it', () => {
    expect(outsideWindow([{ rx_at: 'not a date' }, at(40 * MIN)], 30 * MIN, NOW).count).toBe(1)
  })
  it('handles an empty list', () => {
    expect(outsideWindow([], 30 * MIN, NOW)).toEqual({ count: 0, oldestAgeMs: 0 })
  })
})

// #638: the header printed `view.length + ' rx'`, and the view is capped at
// 200 rows, so every session that heard more than that read `200 RX` for the
// rest of its life — the size of a window, standing where a count belongs.
// Every screenshot from the 12 September drive shows exactly that.
//
// It now says the real total for the stand you are on. The app can count its
// own store; the map has no store to count, so it says what the server told
// it — a full page with more rows behind it is a lower bound, not a total.
describe('rxCountLabel — the header says how many there are, not how many fit', () => {
  it('prints the total for the stand', () => {
    expect(rxCountLabel(7)).toBe('7 rx')
    expect(rxCountLabel(0)).toBe('0 rx')
  })
  // The backlog pill already groups thousands (app/src/backlog.js); a count
  // that reaches four digits on a long drive reads the same way here.
  it('groups thousands, as the backlog pill does', () => {
    expect(rxCountLabel(1483)).toBe('1,483 rx')
  })
  it('marks a total that is only a lower bound', () => {
    expect(rxCountLabel(200, true)).toBe('200+ rx')
    expect(rxCountLabel(1483, true)).toBe('1,483+ rx')
  })
  it('leaves a complete total unmarked', () => {
    expect(rxCountLabel(200, false)).toBe('200 rx')
  })
})

// #619: the three newest receptions could not be put under the marker. The
// list is padded above by the playhead lane and not at all below (#560), so it
// clamps at count + playhead - lanes lanes of scroll, and an index read off
// the scroll position alone can never name a row past that. Tapping one of the
// last three set a scrollTop the browser threw away, so the marker did not
// move and the tap read as dead; the HUD that shares the marker showed the
// fourth-newest while the ticker was following.
//
// Decided (Kasper, 12 September): the marker moves instead of the list. Once
// the scroll is clamped the marker walks down the last lanes onto the bottom
// row and the fade follows it, so no blank lanes come back.
describe('rxMaxScroll — how far the list can be scrolled, in lanes', () => {
  it('is the content that does not fit: the rows plus the padding above them', () => {
    expect(rxMaxScroll(200, 10)).toBe(196)
    expect(rxMaxScroll(12, 10)).toBe(8)
  })
  it('is zero when there is nothing to scroll past', () => {
    expect(rxMaxScroll(0, 10)).toBe(0)
    expect(rxMaxScroll(1, 1)).toBe(0)
  })
})

describe('rxScrollLane — the scroll that shows a row, never past the clamp', () => {
  it('scrolls to the row itself while the list can still reach it', () => {
    expect(rxScrollLane(0, 200, 10)).toBe(0)
    expect(rxScrollLane(120, 200, 10)).toBe(120)
  })
  // The old bug in one assertion: these four rows all sit at the same clamped
  // scroll, so scroll position cannot tell them apart and the marker has to.
  it('stops at the clamp rather than asking for scroll that does not exist', () => {
    for (const i of [196, 197, 198, 199]) expect(rxScrollLane(i, 200, 10), `row ${i}`).toBe(196)
  })
})

describe('rxMarkerLane — the marker walks the last lanes once the list clamps (#619)', () => {
  it('holds the marker on the playhead lane for every row the list can scroll to', () => {
    for (let i = 0; i <= rxMaxScroll(200, 10); i++) {
      expect(rxMarkerLane(i, 200, 10), `row ${i}`).toBe(rxPlayhead(10))
    }
  })
  it('walks it down the three lanes below the playhead for the three newest rows', () => {
    expect(rxMarkerLane(197, 200, 10)).toBe(7)
    expect(rxMarkerLane(198, 200, 10)).toBe(8)
    expect(rxMarkerLane(199, 200, 10)).toBe(9)
  })
  // The defect itself: before this the newest reception was unreachable on a
  // full card, which is what took the HUD off it.
  it('reaches the newest reception at every card size', () => {
    for (const count of [1, 2, 3, 5, 9, 10, 60, 200]) {
      const lanes = rxLanes(count, 0)
      expect(rxMarkerLane(count - 1, count, lanes), `${count} receptions`).toBe(lanes - 1)
    }
  })
  it('never puts the marker off the card', () => {
    for (const count of [1, 3, 7, 10, 200]) {
      const lanes = rxLanes(count, 0)
      for (let i = 0; i < count; i++) {
        const lane = rxMarkerLane(i, count, lanes)
        expect(lane, `row ${i} of ${count}`).toBeGreaterThanOrEqual(0)
        expect(lane, `row ${i} of ${count}`).toBeLessThanOrEqual(lanes - 1)
      }
    }
  })
})

// The fade is measured from the marker, not from the playhead lane it usually
// sits on: with the marker walked down to the bottom lane there is nothing
// under it, and the rows above it span the whole card.
describe('rxBelow — the lanes under the marker, wherever it is', () => {
  it('is the playhead geometry while the marker sits on its own lane', () => {
    expect(rxBelow(10, rxPlayhead(10))).toBe(rxBelow(10))
    expect(rxBelow(10, 6)).toBe(3)
  })
  it('is nothing once the marker has walked onto the bottom lane', () => {
    expect(rxBelow(10, 9)).toBe(0)
    expect(rxBelow(10, 8)).toBe(1)
  })
})
