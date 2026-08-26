import { describe, it, expect } from 'vitest'
import {
  dedupeSenders, senderList, topSenders, targetParts, relTime,
  senderParams, encodeSelection, decodeSelection, withoutSenderFilters, targetChipLabel,
} from './targetpicker.js'

const pt = (o) => ({ lat: 51, lon: 4, rssi: -80, rx_at: '2026-07-22T10:00:00Z', ...o })

describe('dedupeSenders — one row per sender_id, keeping the most recent', () => {
  it('collapses repeated senders to their newest reception', () => {
    const rows = [
      pt({ sender_id: 'aa', rssi: -90, rx_at: '2026-07-22T10:00:00Z' }),
      pt({ sender_id: 'aa', rssi: -70, rx_at: '2026-07-22T10:05:00Z' }),
      pt({ sender_id: 'bb', rx_at: '2026-07-22T10:01:00Z' }),
    ]
    const out = dedupeSenders(rows)
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.sender_id === 'aa').rssi).toBe(-70)
  })
  it('drops rows with no sender_id', () => {
    expect(dedupeSenders([pt({ sender_id: null }), pt({ sender_id: '' })])).toEqual([])
  })
  it('handles empty/missing input', () => {
    expect(dedupeSenders([])).toEqual([])
    expect(dedupeSenders(undefined)).toEqual([])
  })
})

// Prefix merging (#331): one physical node is named by up to three reception
// kinds — a full 64-hex advert pubkey, a 3-byte discover prefix, a 2-byte relay
// path hash — and the picker listed each as its own row (see the app's
// equivalent, feed.js mergePrefixGroups, #267/#268).
const full = (head) => head + '11'.repeat((64 - head.length) / 2)
const FULL_A = full('4a4abe')                  // 4a4abe1111…
const FULL_B = '4a4a' + 'ff'.repeat(30)        // 4a4aff…  — shares 4a4a, not 4a4abe
const FULL_C = full('99aabb')
const kindRow = (kind) => (id, o = {}) => pt({ sender_id: id, sender_kind: kind, sender_label: '', ...o })
const advert = kindRow('advert_pubkey')
const discover = kindRow('discover_pubkey')
const relay = kindRow('relay')
const channel = kindRow('channel_name')
const ids = (out) => out.map((r) => r.sender_id).sort()

describe('dedupeSenders — prefix variants of one node collapse to one row', () => {
  it('merges a 2-byte relay path hash into the advert full pubkey', () => {
    const out = dedupeSenders([advert(FULL_A), relay('4a4a', { rx_at: '2026-07-22T10:05:00Z' })])
    expect(out).toHaveLength(1)
    expect(out[0].sender_id).toBe(FULL_A)                   // named by the node's own key
    expect(out[0].merged_ids).toEqual(['4a4a', FULL_A].sort())
  })

  it('merges a 3-byte discover prefix onto the same row', () => {
    const out = dedupeSenders([advert(FULL_A), discover('4a4abe'), relay('4a4a')])
    expect(out).toHaveLength(1)
    expect(out[0].sender_id).toBe(FULL_A)
    expect(out[0].merged_ids).toHaveLength(3)
  })

  it('collapses a 2-byte into a 3-byte prefix when no advert is in the window', () => {
    const out = dedupeSenders([discover('4a4abe'), relay('4a4a')])
    expect(out).toHaveLength(1)
    expect(out[0].sender_id).toBe('4a4abe')                 // longest known id wins
  })

  it('keeps the newest reception for signal and time, under the canonical id', () => {
    const out = dedupeSenders([
      advert(FULL_A, { rssi: -95, rx_at: '2026-07-22T10:00:00Z' }),
      relay('4a4a', { rssi: -70, rx_at: '2026-07-22T10:05:00Z' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sender_id: FULL_A, rssi: -70, rx_at: '2026-07-22T10:05:00Z' })
  })

  it('carries a resolved name onto the merged row even when the newest row is unresolved', () => {
    const out = dedupeSenders([
      advert(FULL_A, { sender_label: 'NEO7HI', rx_at: '2026-07-22T10:00:00Z' }),
      relay('4a4a', { rx_at: '2026-07-22T10:05:00Z' }),
    ])
    expect(out[0].sender_label).toBe('NEO7HI')
  })

  it('merges unresolved rows too, and still shows an id', () => {
    // Deliberately looser than the app (feed.js requires a matching resolved
    // name on both sides): on the web every row in the reported case was
    // unresolved, so a name gate would never merge anything.
    const out = dedupeSenders([discover('4a4abe'), relay('4a4a')])
    expect(out).toHaveLength(1)
    expect(targetParts(out[0])).toEqual({ primary: '4a4abe (name not resolved)', secondary: '4a4abe' })
  })

  it('refuses a prefix that could be either of two nodes', () => {
    const out = dedupeSenders([advert(FULL_A), advert(FULL_B), relay('4a4a')])
    expect(out).toHaveLength(3)
    expect(ids(out)).toEqual(['4a4a', FULL_A, FULL_B].sort())
  })

  it('refuses when the two sides resolve to different names', () => {
    const out = dedupeSenders([advert(FULL_A, { sender_label: 'Zuid' }), relay('4a4a', { sender_label: 'Noord' })])
    expect(out).toHaveLength(2)
  })

  // The name gate is only a pairwise check against the LONGEST candidate, so
  // two members could each be compatible with an unlabelled longest id while
  // disagreeing with each other, and land in one group anyway. Not exotic:
  // sender_label IS set on 2/3-byte prefixes (the repeater-name backfill sets
  // ~20% of them), and the largest long-id population — 8-byte discover ids —
  // carries no label at all, so "longest is unlabelled" is the usual shape.
  it('refuses a group whose members disagree, even via an unlabelled longest id', () => {
    const out = dedupeSenders([
      discover('4a4abe11', { sender_label: '' }),   // longest, unlabelled — compatible with both
      relay('4a4a', { sender_label: 'Zuid' }),
      relay('4a4abe', { sender_label: 'Noord' }),
    ])
    expect(out).toHaveLength(3)
    expect(ids(out)).toEqual(['4a4a', '4a4abe', '4a4abe11'])
    for (const r of out) expect(r.merged_ids).toHaveLength(1)
  })

  it('still merges through an unlabelled longest id when the names agree', () => {
    const out = dedupeSenders([
      discover('4a4abe11', { sender_label: '' }),
      relay('4a4a', { sender_label: 'Zuid' }),
      relay('4a4abe', { sender_label: 'Zuid' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sender_id).toBe('4a4abe11')
    expect(out[0].sender_label).toBe('Zuid')
  })

  it('treats case and padding differences as the same name, not a disagreement', () => {
    const out = dedupeSenders([
      advert(FULL_A, { sender_label: 'BE-ZOD-MOSKEE-DIS' }),
      relay('4a4a', { sender_label: ' be-zod-moskee-dis ' }),
    ])
    expect(out).toHaveLength(1)
  })

  // A label on a full advert pubkey is authoritative; one on a 2-byte prefix is
  // a backfilled unique-match guess. Picking with .find over Map insertion order
  // chose between them by accident of which reception arrived first.
  it('names a merged row from the longest id that has a label', () => {
    const rows = [
      relay('4a4a', { sender_label: ' be-zod-moskee-dis ', rx_at: '2026-07-22T10:05:00Z' }),
      advert(FULL_A, { sender_label: 'BE-ZOD-MOSKEE-DIS', rx_at: '2026-07-22T10:00:00Z' }),
    ]
    expect(dedupeSenders(rows)[0].sender_label).toBe('BE-ZOD-MOSKEE-DIS')
    expect(dedupeSenders([...rows].reverse())[0].sender_label).toBe('BE-ZOD-MOSKEE-DIS')
  })

  it('falls back to a shorter id label when the longest has none', () => {
    const out = dedupeSenders([advert(FULL_A), relay('4a4a', { sender_label: 'Zuid' })])
    expect(out).toHaveLength(1)
    expect(out[0].sender_label).toBe('Zuid')
  })

  it('never merges a channel_name id, whatever it looks like', () => {
    // channel_name's id is a decrypted display name, not part of the pubkey
    // namespace, so a hex-looking coincidence must not fold two nodes together.
    expect(dedupeSenders([advert(FULL_A), channel('4a4a')])).toHaveLength(2)
  })

  it('never merges two full pubkeys with each other', () => {
    expect(dedupeSenders([advert(FULL_A), advert(FULL_B)])).toHaveLength(2)
    expect(dedupeSenders([advert(FULL_A), advert(FULL_C)])).toHaveLength(2)
  })

  it('leaves a 1-byte path hash on its own row', () => {
    // 1 byte is 1-in-256; the reported rule starts at 2 bytes.
    expect(dedupeSenders([advert(FULL_A), relay('4a')])).toHaveLength(2)
  })

  it('does not depend on the input order', () => {
    expect(dedupeSenders([relay('4a4a'), advert(FULL_A)])).toHaveLength(1)
  })

  it('leaves a prefix with nothing longer to attach to alone', () => {
    expect(dedupeSenders([relay('4a4a'), relay('99aa')])).toHaveLength(2)
  })
})

describe('senderList / topSenders over merged rows', () => {
  it('ranks a merged node once, on its newest reception', () => {
    const rows = [
      advert(FULL_A, { rssi: -95, rx_at: '2026-07-22T10:00:00Z' }),
      relay('4a4a', { rssi: -70, rx_at: '2026-07-22T10:05:00Z' }),
    ]
    const out = topSenders(rows, { nowMs: Date.parse('2026-07-22T10:05:10Z'), count: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].sender_id).toBe(FULL_A)
    expect(senderList(rows)).toHaveLength(1)
  })
})

describe('senderList — name-sorted (case-insensitive), optionally limited', () => {
  const rows = [
    pt({ sender_id: 'cc', sender_label: 'charlie' }),
    pt({ sender_id: 'aa', sender_label: 'Alpha' }),
    pt({ sender_id: 'bb', sender_label: '' }), // unresolved -> sorts by id
  ]
  it('sorts by label (falling back to id), case-insensitive', () => {
    expect(senderList(rows).map((r) => r.sender_id)).toEqual(['aa', 'bb', 'cc'])
  })
  it('respects a limit', () => {
    expect(senderList(rows, { limit: 2 })).toHaveLength(2)
  })
})

describe('topSenders — recency+RSSI score, ~1dB per 30s of age', () => {
  it('ranks a strong-but-stale sender below a weaker-but-fresh one', () => {
    const now = Date.parse('2026-07-22T10:10:00Z')
    const rows = [
      pt({ sender_id: 'stale', rssi: -50, rx_at: '2026-07-22T09:00:00Z' }), // 70 min old
      pt({ sender_id: 'fresh', rssi: -80, rx_at: '2026-07-22T10:09:50Z' }), // 10s old
    ]
    expect(topSenders(rows, { nowMs: now, count: 2 }).map((r) => r.sender_id)).toEqual(['fresh', 'stale'])
  })
  it('caps to count', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => pt({ sender_id: id }))
    expect(topSenders(rows, { nowMs: Date.now(), count: 3 })).toHaveLength(3)
  })
})

describe('targetParts — primary/secondary label split', () => {
  it('shows the resolved name as primary, byte-prefix as secondary', () => {
    expect(targetParts(pt({ sender_id: 'aa11bb22cc33', sender_label: 'NEO7HI' })))
      .toEqual({ primary: 'NEO7HI', secondary: 'aa11bb' })
  })
  it('falls back to the id prefix + a marker when unresolved', () => {
    expect(targetParts(pt({ sender_id: 'aa11bb22cc33', sender_label: '' })))
      .toEqual({ primary: 'aa11bb (name not resolved)', secondary: 'aa11bb' })
  })
  it('handles a missing id', () => {
    expect(targetParts(pt({ sender_id: null, sender_label: '' }))).toEqual({ primary: '—', secondary: '' })
  })

  // meshpacket.js carries a 1-byte hash as its own sender_label, so the label
  // branch would print "77" looking exactly like a resolved short name. This
  // list has no kind gate (unlike app's feed.js), so it is the only thing
  // standing between a 256-way collision space and a row that reads as an
  // identity. Both kinds that carry one are covered.
  it('marks a 1-byte path hash rather than presenting it as a name', () => {
    expect(targetParts(pt({ sender_id: '77', sender_label: '77', sender_kind: 'path_hash' })))
      .toEqual({ primary: '#77', secondary: '77' })
  })
  it('marks a 1-byte direct hash the same way', () => {
    expect(targetParts(pt({ sender_id: '4a', sender_label: '4a', sender_kind: 'direct_hash' })))
      .toEqual({ primary: '#4a', secondary: '4a' })
  })
  // The guard is on the KIND, not on the length: a resolver name that happens
  // to be short must still render as a name.
  it('leaves a short resolved name alone', () => {
    expect(targetParts(pt({ sender_id: 'aa11bb22cc33', sender_label: 'ZZ', sender_kind: 'relay' })))
      .toEqual({ primary: 'ZZ', secondary: 'aa11bb' })
  })
})

describe('relTime — ported from app/src/feed.js (not shared: web\'s data model differs, #223)', () => {
  const NOW = Date.parse('2026-07-22T10:00:00Z')
  it('formats seconds/minutes/hours', () => {
    expect(relTime('2026-07-22T09:59:45Z', NOW)).toBe('15s')
    expect(relTime('2026-07-22T09:55:00Z', NOW)).toBe('5m')
  })
  it('returns — for missing/invalid timestamps', () => {
    expect(relTime(null, NOW)).toBe('—')
  })
})


// #223/#288: the wire format. Exact picks go out as a repeated ?senders=
// param and the prefix search keeps ?sender=, so no delimiter has to be
// unreachable inside a sender_id. senderParams turns a parsed field into the
// [key, value] pairs a URLSearchParams should carry.
describe('senderParams — the two sender filters on two params (#223)', () => {
  it('emits one senders= entry per picked id', () => {
    expect(senderParams({ ids: ['aaaa', 'bbbb'], prefix: '' }))
      .toEqual([['senders', 'aaaa'], ['senders', 'bbbb']])
  })
  it('emits a single senders= for a one-id pick, with no delimiter trick', () => {
    expect(senderParams({ ids: ['aaaa'], prefix: '' })).toEqual([['senders', 'aaaa']])
  })
  it('keeps punctuation in a picked id intact, which is the whole point', () => {
    expect(senderParams({ ids: ['bob; k.'], prefix: '' })).toEqual([['senders', 'bob; k.']])
  })
  it('sends a typed prefix on sender=, never senders=', () => {
    expect(senderParams({ ids: [], prefix: 'Bob; K.' })).toEqual([['sender', 'Bob; K.']])
  })
  it('lets a picked selection win over a stale typed prefix', () => {
    // Picking and typing are different match kinds (exact vs leading-prefix);
    // combining them silently would be surprising, so the pick wins.
    expect(senderParams({ ids: ['aaaa'], prefix: 'bb' })).toEqual([['senders', 'aaaa']])
  })
  it('emits nothing when neither filter is active', () => {
    expect(senderParams({ ids: [], prefix: '' })).toEqual([])
    expect(senderParams({})).toEqual([])
    expect(senderParams()).toEqual([])
  })
})

// The picker's selection is its own state now, so it needs its own encoding
// for the shareable URL and localStorage. A sender_id is arbitrary operator
// text, so the encoding cannot be delimiter-joined either — JSON survives any
// content, and a corrupt value degrades to "nothing selected" rather than
// throwing during boot.
describe('encodeSelection / decodeSelection (#288)', () => {
  it('round-trips ids containing every delimiter we ever tried', () => {
    const ids = ['bob, k.', 'ann;b', 'x"y', 'plain']
    expect(decodeSelection(encodeSelection(ids))).toEqual(ids)
  })
  it('encodes an empty selection as an empty string, so the param drops out', () => {
    expect(encodeSelection([])).toBe('')
    expect(encodeSelection(null)).toBe('')
  })
  it('decodes junk to an empty selection instead of throwing', () => {
    for (const junk of ['', 'not json', '{}', '[1,2]', 'null', undefined]) {
      expect(decodeSelection(junk)).toEqual([])
    }
  })
  it('drops non-string and blank entries from a decoded list', () => {
    expect(decodeSelection('["aa", 3, "", "  ", "bb"]')).toEqual(['aa', 'bb'])
  })
})

// #288 blocker 4: the candidate pool is what you pick FROM, so it must not
// narrow by the sender filters — otherwise selecting a sender shrinks the list
// you are selecting from, and every click refetches. Both sender inputs travel
// under one key (senderPairs), so one exclusion covers the selection and the
// typed prefix together. Named here rather than inlined at the call site: the
// key was renamed once already and the stale literal silently re-broke the
// cache without failing anything.
describe('withoutSenderFilters (#288)', () => {
  it('drops the sender filters and keeps everything else', () => {
    const f = { hunter: 'abc', senderPairs: [['senders', 'aa']], types: 'advert', hops: '0' }
    expect(withoutSenderFilters(f)).toEqual({ hunter: 'abc', types: 'advert', hops: '0' })
  })

  it('gives the same result whatever the selection is, so the cache holds', () => {
    const base = { hunter: 'abc', types: 'advert' }
    const none = withoutSenderFilters({ ...base, senderPairs: [] })
    const one = withoutSenderFilters({ ...base, senderPairs: [['senders', 'aa']] })
    const many = withoutSenderFilters({ ...base, senderPairs: [['senders', 'aa'], ['senders', 'bb']] })
    const typed = withoutSenderFilters({ ...base, senderPairs: [['sender', 'bo']] })
    expect(one).toEqual(none)
    expect(many).toEqual(none)
    expect(typed).toEqual(none)
  })

  it('never leaks senderPairs through, which would stringify an array into the query', () => {
    expect(Object.keys(withoutSenderFilters({ senderPairs: [['senders', 'aa']] }))).toEqual([])
  })

  it('tolerates an absent or empty filter object', () => {
    expect(withoutSenderFilters({})).toEqual({})
    expect(withoutSenderFilters()).toEqual({})
  })
})

// The picker lists what you can pick, so an ignored node has no business in
// it (#494). The app's list takes the same option (app/src/targetlist.js).
describe('senderList — ignored nodes', () => {
  const rows = [
    pt({ sender_id: 'aa', sender_label: 'Alpha' }),
    pt({ sender_id: 'bb', sender_label: 'Bravo' }),
  ]
  it('drops an ignored sender from the list', () => {
    expect(senderList(rows, { ignore: new Set(['aa']) }).map((r) => r.sender_id)).toEqual(['bb'])
  })
  it('matches case-insensitively', () => {
    expect(senderList([pt({ sender_id: 'AA', sender_label: 'Alpha' })], { ignore: new Set(['aa']) })).toEqual([])
  })
  it('lists everything when the set is empty or absent', () => {
    expect(senderList(rows, { ignore: new Set() })).toHaveLength(2)
    expect(senderList(rows)).toHaveLength(2)
  })
  // A merged row is one node under several prefixes (#331): ignoring it under
  // any one of them has to take the whole row out, not leave it listed under
  // the other two.
  it('drops a merged row when any of its ids is ignored', () => {
    // The 2-byte relay hash and the advert pubkey are one node, so ignoring it
    // by the short prefix has to take the merged row out.
    const merged = [advert(FULL_A), relay('4a4a', { rx_at: '2026-07-22T10:05:00Z' })]
    expect(senderList(merged, { ignore: new Set() })).toHaveLength(1)
    expect(senderList(merged, { ignore: new Set(['4a4a']) })).toEqual([])
    expect(senderList(merged, { ignore: new Set([FULL_A]) })).toEqual([])
  })
})

// The pinned Top section picks from the same pool as the list, so it has to
// drop the same rows (#494) -- otherwise an ignored node stays pinned above a
// list it is gone from. The app's list passes ignore to both (targetlist.js).
describe('topSenders — ignored nodes', () => {
  const NOW = Date.parse('2026-07-22T10:00:00Z')
  const rows = [
    pt({ sender_id: 'aa', sender_label: 'Alpha', rssi: -60, rx_at: '2026-07-22T09:59:50Z' }),
    pt({ sender_id: 'bb', sender_label: 'Bravo', rssi: -90, rx_at: '2026-07-22T09:59:50Z' }),
  ]
  it('leaves an ignored sender out of the Top section', () => {
    expect(topSenders(rows, { count: 3, nowMs: NOW }).map((r) => r.sender_id)).toEqual(['aa', 'bb'])
    expect(topSenders(rows, { count: 3, nowMs: NOW, ignore: new Set(['aa']) }).map((r) => r.sender_id)).toEqual(['bb'])
  })
  it('drops a merged row by any of its ids', () => {
    const merged = [advert(FULL_A, { rssi: -60 }), relay('4a4a', { rssi: -60, rx_at: '2026-07-22T09:59:55Z' })]
    expect(topSenders(merged, { count: 3, nowMs: NOW })).toHaveLength(1)
    expect(topSenders(merged, { count: 3, nowMs: NOW, ignore: new Set(['4a4a']) })).toEqual([])
  })
})

// The picker's button label (#495). The app's chip is the reference
// (app/src/app.js:2039): a name for one node, a count above that, never a
// full-length id, and it counts NODES rather than id variants (#268).
describe('targetChipLabel — what the picker button says', () => {
  const row = (o) => ({ sender_id: 'aa', sender_label: '', merged_ids: ['aa'], ...o })

  it('reads Select target with nothing picked', () => {
    const out = targetChipLabel([], { rows: [row()] })
    expect(out.text).toBe('Select target')
    expect(out.count).toBe(0)
    expect(out.title).toBe('')
  })

  it('names the node when one is picked', () => {
    const rows = [row({ sender_id: 'aabb', sender_label: 'KH-01', merged_ids: ['aabb'] })]
    const out = targetChipLabel(['aabb'], { rows })
    expect(out.text).toBe('⌖ KH-01')
    expect(out.title).toBe('KH-01')
    expect(out.count).toBe(1)
  })

  // The #268 trap, in the map's own shape: multiselect.js selects every id
  // variant of a merged row, so a single tap puts three ids in the selection.
  it('counts a merged row as one target, not as its id variants', () => {
    const rows = [row({
      sender_id: 'aabbccdd', sender_label: 'KH-01',
      merged_ids: ['aabb', 'aabbcc', 'aabbccdd'],
    })]
    const out = targetChipLabel(['aabb', 'aabbcc', 'aabbccdd'], { rows })
    expect(out.count).toBe(1)
    expect(out.text).toBe('⌖ KH-01')
  })

  it('counts separate rows separately', () => {
    const rows = [
      row({ sender_id: 'aabb', sender_label: 'KH-01', merged_ids: ['aabb'] }),
      row({ sender_id: 'ccdd', sender_label: 'KH-02', merged_ids: ['ccdd'] }),
    ]
    const out = targetChipLabel(['aabb', 'ccdd'], { rows })
    expect(out.text).toBe('⌖ 2 targets')
    expect(out.title).toBe('2 targets')
    expect(out.count).toBe(2)
  })

  // A deep link restores a selection before the picker has ever rendered, so
  // there are no rows to read a label from.
  it('falls back to a resolved name when the picker holds no rows', () => {
    const out = targetChipLabel(['aabbccdd'], { rows: [], nameOf: (id) => (id === 'aabbccdd' ? 'KH-09' : '') })
    expect(out.text).toBe('⌖ KH-09')
    expect(out.count).toBe(1)
  })

  // #305: a full-length id pushed the topbar off screen, so an unresolved id
  // shows the same 6-char prefix the target list uses.
  it('never renders a full-length id', () => {
    const id = 'a'.repeat(64)
    const out = targetChipLabel([id], { rows: [] })
    expect(out.text).toBe('⌖ aaaaaa')
    expect(out.text).not.toContain(id)
  })

  it('matches case-insensitively, since the selection is lower-cased', () => {
    const rows = [row({ sender_id: 'AABB', sender_label: 'KH-01', merged_ids: ['AABB'] })]
    expect(targetChipLabel(['aabb'], { rows }).count).toBe(1)
  })

  it('handles a missing selection', () => {
    expect(targetChipLabel(undefined, {}).text).toBe('Select target')
  })
})

// #499 review: the button and the row have to agree about the same node. Two
// kinds carry a 1-byte hash AS their label (direct_hash, and path_hash since
// #521), so taking sender_label first rendered the byte as a name on the
// button while targetParts marked it with a # in the row right beside it.
describe('targetChipLabel — a 1-byte hash is never a name', () => {
  const hashRow = (kind) => ({ sender_id: '77', sender_label: '77', sender_kind: kind, merged_ids: ['77'] })

  for (const kind of ['direct_hash', 'path_hash']) {
    it(`marks a ${kind} the way the row does, rather than naming it`, () => {
      const rows = [hashRow(kind)]
      const chip = targetChipLabel(['77'], { rows })
      // The row's own rendering is the reference: whatever the list says about
      // this node, the button says the same thing.
      expect(targetParts(rows[0]).primary).toBe('#77')
      expect(chip.text).toBe('⌖ #77')
      expect(chip.title).toBe('#77')
    })
  }

  it('still names a kind whose label is a real name', () => {
    const rows = [{ sender_id: 'aabb', sender_label: 'KH-01', sender_kind: 'advert_pubkey', merged_ids: ['aabb'] }]
    expect(targetChipLabel(['aabb'], { rows }).text).toBe('⌖ KH-01')
  })

  // The resolver is not consulted for these: there is nothing to resolve, and
  // asking would put a guessed name on a byte that 255 other nodes share.
  it('does not take a resolved name for a hash id either', () => {
    const rows = [hashRow('path_hash')]
    const out = targetChipLabel(['77'], { rows, nameOf: () => 'should never be used' })
    expect(out.text).toBe('⌖ #77')
  })
})
