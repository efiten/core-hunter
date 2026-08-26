import { describe, it, expect } from 'vitest'
import { relTime, senderList, topSenders, targetParts, selectedRepeaterIds, clusterKey, expandSelection, selectionKeyFor, idPrefix, matchesTarget } from '../feed.js'

const rec = (o) => ({ sender_kind: 'channel_name', sender_id: 'Spammer', rx_at: '2026-06-29T10:00:00Z', ...o })

// A real advert carries the full 32-byte pubkey (meshpacket.js), so merge
// anchors are 64 hex. pk() builds a distinct one from a short head.
const pk = (head) => head + '0'.repeat(64 - head.length)

describe('senderList', () => {
  it('keeps channel_name + advert_pubkey + discover_pubkey + relay kinds, drops the rest', () => {
    const out = senderList([
      rec({ sender_kind: 'channel_name', sender_id: 'A' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: 'B' }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'BB' }),
      rec({ sender_kind: 'relay', sender_id: 'C' }),
      rec({ sender_kind: 'direct_hash', sender_id: 'D' }),
      rec({ sender_kind: null, sender_id: null }),
    ], {})
    expect(out.map((r) => r.sender_id)).toEqual(['A', 'B', 'BB', 'C'])
  })
  it('includes a last-hop repeater (relay-kind) as a selectable target', () => {
    const out = senderList([rec({ sender_kind: 'relay', sender_id: 'abcd' })], {})
    expect(out.map((r) => r.sender_id)).toEqual(['abcd'])
  })
  it('drops ignored sender ids (case-insensitive)', () => {
    const out = senderList([rec({ sender_id: 'AA' }), rec({ sender_id: 'bb' })], { ignore: new Set(['aa']) })
    expect(out.map((r) => r.sender_id)).toEqual(['bb'])
  })
  it('dedupes per sender, keeping the most recent reception', () => {
    const out = senderList([
      rec({ sender_id: 'A', rssi: -90, rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_id: 'A', rssi: -60, rx_at: '2026-06-29T10:05:00Z' }),
    ], {})
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ rssi: -60, rx_at: '2026-06-29T10:05:00Z' })
  })
  it('sorts by resolved label (falling back to sender_id), case-insensitively', () => {
    const out = senderList([
      rec({ sender_id: 'charlie' }),
      rec({ sender_id: 'bravo', sender_label: 'Alpha' }),
      rec({ sender_id: 'delta', sender_label: 'bravo-label' }),
    ], {})
    expect(out.map((r) => r.sender_id)).toEqual(['bravo', 'delta', 'charlie'])
  })
  it('respects limit for lazy-loaded batches, without affecting the sort order', () => {
    const out = senderList([
      rec({ sender_id: 'alpha' }),
      rec({ sender_id: 'bravo' }),
      rec({ sender_id: 'charlie' }),
    ], { limit: 2 })
    expect(out.map((r) => r.sender_id)).toEqual(['alpha', 'bravo'])
  })
})

// #268: prefix compatibility is not transitive, so it must never be closed over.
// A short relay id can be a prefix of two different full pubkeys; treating that
// as evidence merges two physically distinct nodes into one target, and the
// hunt then reads RSSI samples from both transmitters as if they were one.
// The rule is: a prefix attaches to at most ONE full-pubkey anchor, and a prefix
// matching two or more anchors is evidence AGAINST merging, not for it — the
// same meaning the resolver's own `ambiguous` flag carries.
describe('dedupeSenders never closes over a non-transitive relation (#268)', () => {
  const A = pk('a1b2c3d4')   // node A
  const B = pk('a1b2ffff')   // node B — shares the first 2 bytes with A
  const shared = { sender_label: 'Repeater-Zuid' }

  it('does not merge two distinct full pubkeys bridged by one short relay id', () => {
    const out = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared, rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared, rx_at: '2026-06-29T10:01:00Z' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: B, ...shared, rx_at: '2026-06-29T10:02:00Z' }),
    ], {})
    const cluster = out.find((r) => r.merged_ids.includes(A))
    expect(cluster.merged_ids).not.toContain(B)
  })

  it('leaves an ambiguous prefix on its own row rather than guessing an anchor', () => {
    const out = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: B, ...shared }),
    ], {})
    expect(out).toHaveLength(3)
    expect(out.find((r) => r.merged_ids.includes('a1b2')).merged_ids).toEqual(['a1b2'])
  })

  it('still merges a prefix into its anchor when exactly one anchor matches', () => {
    const out = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
    ], {})
    expect(out).toHaveLength(1)
    expect(out[0].merged_ids).toEqual(['a1b2', A])
  })

  it('never merges two prefixes with no full-pubkey anchor between them', () => {
    const out = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'a1b2c3', ...shared }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual(['a1b2', 'a1b2c3'])
  })

  it('produces the same clusters regardless of input order', () => {
    const rows = [
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: B, ...shared }),
    ]
    const key = (out) => out.map((r) => r.merged_ids.join('+')).sort()
    expect(key(senderList([...rows].reverse(), {}))).toEqual(key(senderList(rows, {})))
  })

  it('never lets a direct_hash reach the merge at all', () => {
    // 1-byte path hashes have a 256-way collision space — excluded by kind,
    // which is what bounds the blast radius of everything above.
    const out = senderList([
      rec({ sender_kind: 'direct_hash', sender_id: 'a1', ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual([A].sort())
  })

  // Same rule for the kind that carries a 1-byte FLOOD path hash. It is named
  // on screen now, which is exactly why it must stay out of here: 'ab' is a
  // prefix of every id starting ab, so one merge would swallow unrelated nodes
  // and one tap would target them.
  it('never lets a path_hash reach the merge either', () => {
    const out = senderList([
      rec({ sender_kind: 'path_hash', sender_id: A.slice(0, 2), ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual([A].sort())
  })
})

describe('dedupeSenders prefix-aware merging (#267)', () => {
  it('merges advert/discover/relay rows for the same node when ids are prefix-compatible and the resolved name matches', () => {
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2c3d4e5f6'), sender_label: 'Repeater-Zuid', rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'a1b2c3', sender_label: 'Repeater-Zuid', rx_at: '2026-06-29T10:05:00Z' }),
      rec({ sender_kind: 'relay', sender_id: 'a1b2', sender_label: 'Repeater-Zuid', rx_at: '2026-06-29T10:02:00Z' }),
    ], {})
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sender_id: 'a1b2c3', rx_at: '2026-06-29T10:05:00Z' })
    expect(out[0].merged_ids).toEqual(['a1b2', 'a1b2c3', pk('a1b2c3d4e5f6')])
  })
  it('treats prefix compatibility case-insensitively', () => {
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('A1B2C3D4'), sender_label: 'Node' }),
      rec({ sender_kind: 'relay', sender_id: 'a1b2', sender_label: 'Node' }),
    ], {})
    expect(out).toHaveLength(1)
  })
  it('does not merge rows with the same name when the ids are not prefix-compatible', () => {
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('aabbcc'), sender_label: 'Same-Name' }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'ffeedd', sender_label: 'Same-Name' }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual([pk('aabbcc'), 'ffeedd'].sort())
  })
  it('does not merge prefix-compatible ids before a name has resolved', () => {
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2c3d4'), sender_label: null }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'a1b2', sender_label: null }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual(['a1b2', pk('a1b2c3d4')].sort())
  })
  it('refuses a prefix that two anchors share, even under different names', () => {
    // The refusal has to count by prefix alone. Gating the count on the name
    // makes it collapse to one match here -- and the hop is equally likely to
    // have come from the other node, so attaching it feeds one node's samples
    // into the other's estimate.
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2c3d4'), sender_label: 'Repeater-Zuid' }),
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2ffff'), sender_label: 'Repeater-Noord' }),
      rec({ sender_kind: 'relay', sender_id: 'a1b2', sender_label: 'Repeater-Zuid' }),
    ], {})
    expect(out).toHaveLength(3)
    const relay = out.find((r) => r.sender_id === 'a1b2')
    expect(relay.merged_ids).toEqual(['a1b2'])
  })
  it('does not merge prefix-compatible ids with different resolved names', () => {
    const out = senderList([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2c3d4'), sender_label: 'Node-One' }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'a1b2', sender_label: 'Node-Two' }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual(['a1b2', pk('a1b2c3d4')].sort())
  })
  it('never merges channel_name rows, even when ids are prefix-compatible and names match', () => {
    const out = senderList([
      rec({ sender_kind: 'channel_name', sender_id: 'ab', sender_label: 'Same' }),
      rec({ sender_kind: 'channel_name', sender_id: 'abcd', sender_label: 'Same' }),
    ], {})
    expect(out.map((r) => r.sender_id).sort()).toEqual(['ab', 'abcd'])
  })
  it('always exposes merged_ids as a lowercased array, even for a row with no merge partner', () => {
    const out = senderList([rec({ sender_kind: 'advert_pubkey', sender_id: 'ABCD', sender_label: 'Solo' })], {})
    expect(out[0].merged_ids).toEqual(['abcd'])
  })
  it('merges the same physical node in the recency/RSSI ranking too', () => {
    const now = Date.parse('2026-06-29T10:05:00Z')
    const out = topSenders([
      rec({ sender_kind: 'advert_pubkey', sender_id: pk('a1b2c3d4'), sender_label: 'Repeater-Zuid', rssi: -60, rx_at: '2026-06-29T10:05:00Z' }),
      rec({ sender_kind: 'discover_pubkey', sender_id: 'a1b2', sender_label: 'Repeater-Zuid', rssi: -80, rx_at: '2026-06-29T10:00:00Z' }),
    ], { count: 3, nowMs: now })
    expect(out).toHaveLength(1)
  })
})

describe('topSenders', () => {
  const now = Date.parse('2026-06-29T10:05:00Z')

  it('ranks by combined recency+RSSI score (rssi - ageSeconds/30) and respects count', () => {
    const out = topSenders([
      rec({ sender_id: 'fresh-weak', rssi: -90, rx_at: '2026-06-29T10:05:00Z' }),   // score -90
      rec({ sender_id: 'strong-stale', rssi: -60, rx_at: '2026-06-29T10:00:00Z' }), // age 300s -> -60-10=-70
      rec({ sender_id: 'strong-fresh', rssi: -60, rx_at: '2026-06-29T10:05:00Z' }), // score -60
      rec({ sender_id: 'mid', rssi: -75, rx_at: '2026-06-29T10:04:30Z' }),          // age 30s -> -75-1=-76
    ], { count: 3, nowMs: now })
    expect(out.map((r) => r.sender_id)).toEqual(['strong-fresh', 'strong-stale', 'mid'])
  })
  it('dedupes per sender and drops ignored ids like senderList', () => {
    const out = topSenders([
      rec({ sender_id: 'A', rssi: -90, rx_at: '2026-06-29T10:00:00Z' }),
      rec({ sender_id: 'A', rssi: -60, rx_at: '2026-06-29T10:05:00Z' }),
      rec({ sender_id: 'B', rssi: -50, rx_at: '2026-06-29T10:05:00Z' }),
    ], { ignore: new Set(['b']), count: 3, nowMs: now })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sender_id: 'A', rssi: -60 })
  })
})

// #268 blocker 3: a trace-ping addresses a node by the first byte of its id
// (sendTracePing uses id.slice(0, 2)), so every variant in a merged cluster
// produces the byte-identical frame. Selecting one merged row must not cost
// 2-3x the airtime — the duty-cycle budget in autoping.js is sized for one.
describe('selectedRepeaterIds collapses variants that transmit identically (#268)', () => {
  const A = pk('a1b2c3d4')
  const rows = [
    { sender_kind: 'relay', sender_id: 'a1b2', rx_at: '2026-06-29T10:00:00Z' },
    { sender_kind: 'relay', sender_id: 'a1b2c3', rx_at: '2026-06-29T10:01:00Z' },
    { sender_kind: 'advert_pubkey', sender_role: 'Repeater', sender_id: A, rx_at: '2026-06-29T10:02:00Z' },
  ]

  it('emits one id per distinct trace-ping frame', () => {
    const out = selectedRepeaterIds(rows, new Set(['a1b2', 'a1b2c3', A.toLowerCase()]))
    expect(out).toHaveLength(1)
  })

  it('still emits one id per genuinely different target', () => {
    const other = [{ sender_kind: 'relay', sender_id: 'ff00', rx_at: '2026-06-29T10:00:00Z' }]
    const out = selectedRepeaterIds([...rows, ...other], new Set(['a1b2', 'ff00']))
    expect(out.sort()).toEqual(['a1b2', 'ff00'])
  })
})

describe('selectedRepeaterIds', () => {
  it('returns selected ids whose most recent record has sender_role Repeater', () => {
    const out = selectedRepeaterIds(
      [rec({ sender_id: 'aa', sender_role: 'Repeater' }), rec({ sender_id: 'bb', sender_role: 'ChatNode' })],
      new Set(['aa', 'bb'])
    )
    expect(out).toEqual(['aa'])
  })
  it('also treats relay-kind (last-hop) records as repeaters', () => {
    const out = selectedRepeaterIds(
      [rec({ sender_id: 'cc', sender_kind: 'relay', sender_role: null })],
      new Set(['cc'])
    )
    expect(out).toEqual(['cc'])
  })
  it('ignores ids not in the selection', () => {
    const out = selectedRepeaterIds(
      [rec({ sender_id: 'aa', sender_role: 'Repeater' })],
      new Set(['bb'])
    )
    expect(out).toEqual([])
  })
  it('uses the most recent record per id to decide repeater status', () => {
    const out = selectedRepeaterIds(
      [
        rec({ sender_id: 'aa', sender_role: 'Repeater', rx_at: '2026-06-29T10:00:00Z' }),
        rec({ sender_id: 'aa', sender_role: 'ChatNode', rx_at: '2026-06-29T10:05:00Z' }),
      ],
      new Set(['aa'])
    )
    expect(out).toEqual([])
  })
  it('returns an empty array for an empty or missing selection', () => {
    expect(selectedRepeaterIds([rec({ sender_id: 'aa', sender_role: 'Repeater' })], new Set())).toEqual([])
    expect(selectedRepeaterIds([rec({ sender_id: 'aa', sender_role: 'Repeater' })], null)).toEqual([])
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-06-29T10:05:00Z')
  it('formats s/m/h', () => {
    expect(relTime('2026-06-29T10:04:30Z', now)).toBe('30s')
    expect(relTime('2026-06-29T10:02:00Z', now)).toBe('3m')
    expect(relTime('2026-06-29T08:05:00Z', now)).toBe('2h')
  })
  it('returns — for missing or unparseable rxAt', () => {
    expect(relTime(null, now)).toBe('—')
    expect(relTime(undefined, now)).toBe('—')
    expect(relTime('not-a-date', now)).toBe('—')
  })
})

describe('targetParts', () => {
  it('shows name as primary and a 3-byte id prefix as secondary when both exist', () => {
    expect(targetParts({ sender_label: 'Repeater-Zuid', sender_id: 'a1b2c3d4e5f6' }))
      .toEqual({ primary: 'Repeater-Zuid', secondary: 'a1b2c3' })
  })
  it('does not pad ids shorter than 3 bytes', () => {
    expect(targetParts({ sender_label: 'Repeater-Zuid', sender_id: 'abcd' }))
      .toEqual({ primary: 'Repeater-Zuid', secondary: 'abcd' })
  })
  it('shows the id prefix plus a "name not resolved" marker as primary when there is no name, and the bare prefix as secondary', () => {
    expect(targetParts({ sender_label: null, sender_id: 'a1b2c3d4e5f6' }))
      .toEqual({ primary: 'a1b2c3 (name not resolved)', secondary: 'a1b2c3' })
  })
  it('falls back to a dash when neither is present', () => {
    expect(targetParts({ sender_label: null, sender_id: null }))
      .toEqual({ primary: '—', secondary: '' })
  })
})

// #267/#268 blocker 4: a selection captured at tap time is a snapshot of the
// ids a node was known by THEN. When that node is later heard under a new
// variant — its first DISCOVER_RESP prefix, say — those receptions fall
// outside the stored set and vanish from the map, while the row
// still renders checked. Silently dropping receptions for the node you are
// actively hunting is the failure a user is least likely to notice, so the
// selection has to name the NODE and be expanded to its current ids on use.
describe('selection follows the node, not the ids it had at tap time (#268)', () => {
  const A = pk('a1b2c3d4')
  const shared = { sender_label: 'Repeater-Zuid' }

  it('keys a merged cluster on its full-pubkey anchor', () => {
    const row = { sender_id: 'a1b2', merged_ids: ['a1b2', A] }
    expect(clusterKey(row)).toBe(A)
  })

  it('keys an unmerged row on its own id, lowercased', () => {
    expect(clusterKey({ sender_id: 'A1B2', merged_ids: ['a1b2'] })).toBe('a1b2')
    expect(clusterKey({ sender_id: 'Spammer', merged_ids: ['spammer'] })).toBe('spammer')
  })

  it('is stable as the cluster grows — the key does not change', () => {
    const before = clusterKey({ sender_id: 'a1b2', merged_ids: ['a1b2', A] })
    const after = clusterKey({ sender_id: 'a1b2', merged_ids: ['a1b2', 'a1b2c3d4e5f6', A] })
    expect(after).toBe(before)
  })

  it('expands a selected key to every id the node currently answers to', () => {
    const rows = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
    ], {})
    expect([...expandSelection([A], rows)].sort()).toEqual(['a1b2', A].sort())
  })

  it('picks up a variant that appeared AFTER the selection was made', () => {
    // The actual bug: tap the row when it is {a1b2, A}, then the node's first
    // discover reply arrives as a longer prefix of the same pubkey. Under the
    // old snapshot that reception was dropped; the key is unchanged, so it is
    // caught now. The prefix has to be a real prefix of A to belong to it.
    const discoverPrefix = A.slice(0, 16)
    const later = senderList([
      rec({ sender_kind: 'relay', sender_id: 'a1b2', ...shared }),
      rec({ sender_kind: 'discover_pubkey', sender_id: discoverPrefix, ...shared }),
      rec({ sender_kind: 'advert_pubkey', sender_id: A, ...shared }),
    ], {})
    expect(expandSelection([A], later).has(discoverPrefix)).toBe(true)
  })

  it('keeps a selected node selected even when it is not currently heard', () => {
    // Nothing in the window matches, so there is no cluster to expand — the
    // key must survive rather than the selection silently emptying.
    expect([...expandSelection([A], [])]).toEqual([A])
  })

  it('expands nothing for an empty selection', () => {
    expect(expandSelection([], []).size).toBe(0)
    expect(expandSelection(null, []).size).toBe(0)
  })
})

describe('selectionKeyFor — the map popup and the target list must agree (#297)', () => {
  const pk = (head) => head + '0'.repeat(64 - head.length)
  const A = pk('a1b2c3d4')
  const rows = [{ sender_id: 'a1b2c3', merged_ids: ['a1b2c3', A] }]

  it('resolves a bare id to its cluster anchor', () => {
    // The map popup dispatches only the sender_id it drew. Keying off that
    // selected one variant while the target-list row rendered as checked for
    // the whole cluster, and the next tap on that row computed a different key.
    expect(selectionKeyFor(rows, 'a1b2c3')).toBe(A)
    expect(selectionKeyFor(rows, A)).toBe(A)
  })

  it('gives the same key whichever variant the caller happens to hold', () => {
    expect(selectionKeyFor(rows, 'a1b2c3')).toBe(selectionKeyFor(rows, A))
  })

  it('still honours an explicit group when the id is in no current cluster', () => {
    // The node has not been heard in this window, so there is no row for it.
    expect(selectionKeyFor([], 'a1b2c3', ['a1b2c3', A])).toBe(A)
  })

  it('falls back to the id itself with no cluster and no group', () => {
    expect(selectionKeyFor([], 'a1b2c3')).toBe('a1b2c3')
  })

  it('is case-insensitive', () => {
    expect(selectionKeyFor(rows, 'A1B2C3')).toBe(A)
  })

  it('returns empty for a missing id rather than inventing a key', () => {
    expect(selectionKeyFor(rows, null)).toBe('')
  })
})

describe('idPrefix — no surface renders a full-length id (#297)', () => {
  it('shortens a full pubkey to the same 6 chars the target list shows', () => {
    expect(idPrefix('a1b2c3d4' + '0'.repeat(56))).toBe('a1b2c3')
  })
  it('leaves an already-short id alone and tolerates nullish input', () => {
    expect(idPrefix('a1b2')).toBe('a1b2')
    expect(idPrefix(null)).toBe('')
  })
})

// #454: a reception nobody can be named for has no sender at all — no kind and
// no id — so it
// must never surface as something you can hunt. Two independent gates in
// dedupeSenders refuse it (the TARGET_KINDS membership test and the null-id
// test), so this goes red only when both are gone; it pins the outcome, not
// either mechanism. Worth having anyway: the target list is the one place
// where "we do not know who this is" must not become a row you can select.
describe('senderList — receptions with no sender (#454)', () => {
  it('never lists a record with no sender', () => {
    const rows = senderList([
      { sender_kind: null, sender_id: null, sender_label: null, rssi: -100, rx_at: '2026-08-22T10:00:00Z' },
      { sender_kind: 'advert_pubkey', sender_id: 'a1b2c3', sender_label: 'Real', rssi: -90, rx_at: '2026-08-22T10:00:01Z' },
    ])
    expect(rows.map((r) => r.sender_id)).toEqual(['a1b2c3'])
  })
})


// #449: the target sheet is browse-only, so picking a node you already know
// means scrolling to it. matchesTarget is the rule behind the search field:
// the name matches anywhere, an id matches only from the front. A substring
// match on an id would make "2b" find every id with those bytes anywhere in
// it, which for a 3-byte hash is most of them — the front is the only part a
// user can read off the HUD and type.
describe('matchesTarget (#449)', () => {
  const row = (o) => ({ sender_id: 'a1b2c3', sender_label: null, ...o })

  it('matches a name substring, not just its start', () => {
    const r = row({ sender_label: 'NL-OAS-Walrick-RP01' })
    expect(matchesTarget(r, 'walr')).toBe(true)
    expect(matchesTarget(r, 'NL-OAS')).toBe(true)
  })
  it('matches case-insensitively on both sides', () => {
    expect(matchesTarget(row({ sender_label: 'NL-OAS-Walrick-RP01' }), 'WALRICK')).toBe(true)
    expect(matchesTarget(row({ sender_id: 'A1B2C3' }), 'a1b')).toBe(true)
  })
  it('matches an id that is not the first entry in merged_ids (#267)', () => {
    const r = row({ sender_id: '2beb', merged_ids: ['2beb', 'a1b2c3' + '0'.repeat(58)] })
    expect(matchesTarget(r, '2beb')).toBe(true)
    expect(matchesTarget(r, 'a1b2c3')).toBe(true)
  })
  it('refuses an id substring that is not a leading prefix', () => {
    expect(matchesTarget(row({ sender_id: '2beb1f' }), 'eb1f')).toBe(false)
  })
  it('falls back to sender_id when the row carries no merged_ids', () => {
    expect(matchesTarget({ sender_id: 'c0ffee' }, 'c0ff')).toBe(true)
    expect(matchesTarget({ sender_id: 'c0ffee' }, 'dead')).toBe(false)
  })
  it('matches everything on an empty or whitespace-only query', () => {
    const r = row({ sender_label: 'Walrick' })
    expect(matchesTarget(r, '')).toBe(true)
    expect(matchesTarget(r, '   ')).toBe(true)
    expect(matchesTarget(r, undefined)).toBe(true)
  })
  it('matches nothing when neither the name nor an id starts with the query', () => {
    expect(matchesTarget(row({ sender_label: 'Walrick' }), 'zzz')).toBe(false)
  })
  it('still matches on the id when the name has not resolved', () => {
    expect(matchesTarget(row({ sender_label: null, sender_id: 'a1b2c3' }), 'a1b2')).toBe(true)
  })
})

// The search narrows what is shown, so it has to run before the lazy-paging
// slice: filtering a page instead of paging the filtered set would hide a
// match that sorts past the first six rows.
describe('senderList — search query (#449)', () => {
  const adv = (id, label, at) => ({ sender_kind: 'advert_pubkey', sender_id: pk(id), sender_label: label, rx_at: at })
  const rows = [
    adv('a1', 'Alpha', '2026-08-24T10:00:00Z'),
    adv('b2', 'Bravo', '2026-08-24T10:00:01Z'),
    adv('c3', 'Charlie', '2026-08-24T10:00:02Z'),
  ]

  it('filters before the limit slice, so a match past the first page still shows', () => {
    expect(senderList(rows, { limit: 1, query: 'charlie' }).map((r) => r.sender_label)).toEqual(['Charlie'])
  })
  it('leaves the list untouched for an empty query', () => {
    expect(senderList(rows, { query: '' }).map((r) => r.sender_label)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(senderList(rows, {}).map((r) => r.sender_label)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
  it('matches on an id prefix as well as a name', () => {
    expect(senderList(rows, { query: 'b2' }).map((r) => r.sender_label)).toEqual(['Bravo'])
  })
})
