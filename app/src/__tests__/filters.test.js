import { describe, it, expect } from 'vitest'
import { PayloadType, getPayloadTypeName } from '@michaelhart/meshcore-decoder'
import { makeFilter, isFilterActive, DEFAULT_FILTER, packetTypeLabel, FILTER_PACKET_TYPES, senderIdClass } from '../filters.js'
import { undecodableReception } from '../meshpacket.js'

const rec = (o) => ({ sender_id: '4a', packet_type: 'Response', is_direct: true, hops: 0,
  rx_at: '2026-06-29T10:00:00Z', ...o })
const now = Date.parse('2026-06-29T10:05:00Z')

describe('makeFilter', () => {
  it('targets a single sender by exact id (case-insensitive)', () => {
    const f = makeFilter({ sender: { ids: ['4A'] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec(), now)).toBe(true)
    expect(f(rec({ sender_id: 'bb' }), now)).toBe(false)
    expect(f(rec({ sender_id: null }), now)).toBe(false)
  })
  it('targets the union (OR) of multiple sender ids', () => {
    const f = makeFilter({ sender: { ids: ['4a', 'bb'] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec({ sender_id: '4a' }), now)).toBe(true)
    expect(f(rec({ sender_id: 'BB' }), now)).toBe(true)
    expect(f(rec({ sender_id: 'cc' }), now)).toBe(false)
  })
  it('an empty target set does not filter by sender', () => {
    const f = makeFilter({ sender: { ids: [] }, types: null, windowMs: null, directOnly: false, ignore: null })
    expect(f(rec({ sender_id: 'anything' }), now)).toBe(true)
  })
  it('ignores listed sender ids', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: false, ignore: new Set(['4a']) })
    expect(f(rec(), now)).toBe(false)
    expect(f(rec({ sender_id: 'cc' }), now)).toBe(true)
  })
  it('directOnly keeps only zero-hop receptions — is_direct is also true for relayed FLOOD (#138)', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: true, ignore: null })
    expect(f(rec({ is_direct: true, hops: 2 }), now)).toBe(false)
    expect(f(rec({ is_direct: true, hops: 0 }), now)).toBe(true)
  })
  it('directOnly drops relayed; window drops stale; types filter', () => {
    expect(makeFilter({ sender: null, types: null, windowMs: null, directOnly: true, ignore: null })(rec({ is_direct: false, hops: 1 }), now)).toBe(false)
    expect(makeFilter({ sender: null, types: null, windowMs: 600000, directOnly: false, ignore: null })(rec({ rx_at: '2026-06-29T09:50:00Z' }), now)).toBe(false)
    expect(makeFilter({ sender: null, types: new Set(['Advert']), windowMs: null, directOnly: false, ignore: null })(rec({ packet_type: 'Response' }), now)).toBe(false)
  })
  it('unnamed keeps only receptions nothing could be attributed to (#501)', () => {
    // A 1-byte path hash is refused by classifyReception, so a flood sent with
    // one leaves no sender at all. That is the only handle such traffic has,
    // and since #455 those receptions are kept rather than dropped.
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: false, unnamed: true, ignore: null })
    expect(f(rec({ sender_id: null }), now)).toBe(true)
    expect(f(rec({ sender_id: '' }), now)).toBe(true)
    expect(f(rec({ sender_id: '4a' }), now)).toBe(false)
  })
  it('unnamed off does not filter by attribution', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: false, unnamed: false, ignore: null })
    expect(f(rec({ sender_id: null }), now)).toBe(true)
    expect(f(rec({ sender_id: '4a' }), now)).toBe(true)
  })
  it('type filter matches decoder packet_type names (GroupText)', () => {
    const f = makeFilter({ sender: null, types: new Set(['GroupText']), windowMs: null, directOnly: false, ignore: null })
    expect(f({ sender_id: 'x', packet_type: 'GroupText', is_direct: true, rx_at: '2026-06-29T10:00:00Z' }, Date.parse('2026-06-29T10:01:00Z'))).toBe(true)
    expect(f({ sender_id: 'x', packet_type: 'Response', is_direct: true, rx_at: '2026-06-29T10:00:00Z' }, Date.parse('2026-06-29T10:01:00Z'))).toBe(false)
  })
})

describe('isFilterActive', () => {
  it('the default filter is not active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER })).toBe(false)
  })
  it('a target selection is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, sender: { ids: ['aa'] } })).toBe(true)
  })
  it('an unnamed selection is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, unnamed: true })).toBe(true)
  })
  it('the default filter has unnamed off', () => {
    expect(DEFAULT_FILTER.unnamed).toBe(false)
  })
  it('the default filter has direct-only off', () => {
    expect(DEFAULT_FILTER.directOnly).toBe(false)
  })
  it('the default plot window is 30 minutes', () => {
    expect(DEFAULT_FILTER.windowMs).toBe(1800000)
  })
  it('turning direct-only on is active', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, directOnly: true })).toBe(true)
  })
  it('a non-default time window is active (including all-time)', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, windowMs: 3600000 })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, windowMs: null })).toBe(true)
  })
  it('a non-empty type set is active; an empty/null set is not', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, types: new Set(['advert']) })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, types: new Set() })).toBe(false)
    expect(isFilterActive({ ...DEFAULT_FILTER, types: null })).toBe(false)
  })
  it('is false for a null/undefined filter', () => {
    expect(isFilterActive(null)).toBe(false)
    expect(isFilterActive(undefined)).toBe(false)
  })
})

describe('packetTypeLabel', () => {
  it('maps a raw decoder packet_type to its friendly filter-chip label', () => {
    expect(packetTypeLabel('TextMessage')).toBe('Direct msg')
    expect(packetTypeLabel('GroupText')).toBe('Channel')
    expect(packetTypeLabel('Advert')).toBe('Advert')
  })
  it('falls back to the raw value for an unrecognised packet_type', () => {
    expect(packetTypeLabel('SomethingNew')).toBe('SomethingNew')
  })
  it('falls back to the raw value for null/undefined', () => {
    expect(packetTypeLabel(null)).toBe(null)
    expect(packetTypeLabel(undefined)).toBe(undefined)
  })
})

describe('FILTER_PACKET_TYPES', () => {
  // The chips are the only way to narrow by type, so a type the decoder can
  // name but the list doesn't carry is a reception nobody can filter for —
  // Control, Path and AnonRequest alone are 22% of the production data (#341).
  it('covers every packet type the decoder can name', () => {
    const covered = new Set(FILTER_PACKET_TYPES.map((t) => t.value))
    const missing = Object.values(PayloadType)
      .filter((v) => typeof v === 'number')
      .map((v) => getPayloadTypeName(v))
      .filter((name) => !covered.has(name))
    expect(missing).toEqual([])
  })
  // #454 class 5: an undecodable packet is filed under a type of its own. A
  // captured type with no chip is the mirror of the #341 bug — makeFilter drops
  // a record whose type is not in the set, so without a chip these rows are
  // hidden the moment any chip is touched and unfilterable when none is.
  it('carries a chip for the type an undecodable packet is filed under', () => {
    expect(FILTER_PACKET_TYPES.map((t) => t.value)).toContain(undecodableReception().packetType)
  })
  it('has a unique value and a non-empty label per entry', () => {
    const values = FILTER_PACKET_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const t of FILTER_PACKET_TYPES) expect(t.label).toBeTruthy()
  })
})

// #454: a stored record can now carry no sender at all. That row
// reaches makeFilter for the first time, so the two branches that read an id
// become load-bearing: they must refuse it where an id is required and admit it
// where only the packet type is.
describe('makeFilter — receptions with no sender (#454)', () => {
  const now = Date.parse('2026-08-22T10:00:00Z')
  const anon = { rx_at: '2026-08-22T09:59:30Z', rssi: -104, hops: 0, packet_type: 'Trace',
    sender_kind: null, sender_id: null, sender_label: null }

  it('excludes it while a target is selected — it cannot be that target', () => {
    const f = makeFilter({ sender: { ids: ['a1b2c3'] }, types: null, windowMs: null, directOnly: false })
    expect(f(anon, now)).toBe(false)
  })

  it('admits it on a packet-type filter, which is what names it', () => {
    const f = makeFilter({ sender: null, types: new Set(['Trace']), windowMs: null, directOnly: false })
    expect(f(anon, now)).toBe(true)
    const other = makeFilter({ sender: null, types: new Set(['Advert']), windowMs: null, directOnly: false })
    expect(other(anon, now)).toBe(false)
  })

  it('filters an undecodable reception by its own chip, like any other type', () => {
    const unknown = { ...anon, packet_type: undecodableReception().packetType }
    const own = makeFilter({ sender: null, types: new Set([unknown.packet_type]), windowMs: null, directOnly: false })
    expect(own(unknown, now)).toBe(true)
    const other = makeFilter({ sender: null, types: new Set(['Advert']), windowMs: null, directOnly: false })
    expect(other(unknown, now)).toBe(false)
  })

  it('is not swept up by the ignore list, which is keyed on ids it does not have', () => {
    const f = makeFilter({ sender: null, types: null, windowMs: null, directOnly: false, ignore: new Set(['a1b2c3']) })
    expect(f(anon, now)).toBe(true)
  })
})


// Sender-id classes (#475). The bucket is the byte length of sender_id, which
// reads as how far the sender can be identified at all. It exists because the
// class that isolates a flood moved: those receptions used to have no sender,
// so `unnamed` caught them; since #521 they carry a byte and nothing did.
describe('senderIdClass', () => {
  it('buckets by byte length, at every boundary', () => {
    expect(senderIdClass({ sender_id: '77', sender_kind: 'path_hash' })).toBe('1b')
    expect(senderIdClass({ sender_id: '4a', sender_kind: 'direct_hash' })).toBe('1b')
    expect(senderIdClass({ sender_id: 'a2a2', sender_kind: 'relay' })).toBe('2b')
    expect(senderIdClass({ sender_id: 'efef79', sender_kind: 'relay' })).toBe('3b')
    expect(senderIdClass({ sender_id: '7b0e24700e0c0d3e', sender_kind: 'discover_pubkey' })).toBe('pubkey')
    expect(senderIdClass({ sender_id: 'ab'.repeat(32), sender_kind: 'advert_pubkey' })).toBe('pubkey')
  })

  it('calls an absent sender unnamed, however it is absent', () => {
    expect(senderIdClass({ sender_id: '', sender_kind: '' })).toBe('unnamed')
    expect(senderIdClass({ sender_id: null })).toBe('unnamed')
    expect(senderIdClass({})).toBe('unnamed')
    expect(senderIdClass(null)).toBe('unnamed')
  })

  // The one bucket that is not a length. Its id is a decrypted display name,
  // so measuring it would be meaningless -- and a 2-character channel name
  // would otherwise land in the 1-byte class.
  it('decides a channel by kind before it measures anything', () => {
    expect(senderIdClass({ sender_id: 'ab', sender_kind: 'channel_name' })).toBe('channel')
    expect(senderIdClass({ sender_id: 'Spammer', sender_kind: 'channel_name' })).toBe('channel')
  })
})

describe('makeFilter — sender-id classes', () => {
  const rec = (o) => ({ packet_type: 'Response', hops: 0, rx_at: '2026-08-26T10:00:00Z', ...o })
  const NOW = Date.parse('2026-08-26T10:00:00Z')
  const rows = [
    rec({ sender_id: '77', sender_kind: 'path_hash' }),
    rec({ sender_id: 'a2a2', sender_kind: 'relay' }),
    rec({ sender_id: '', sender_kind: '' }),
  ]
  const keep = (opts) => rows.filter((r) => makeFilter({ ...DEFAULT_FILTER, windowMs: null, ...opts })(r, NOW))

  it('passes everything when no class is chosen, like the type chips', () => {
    expect(keep({}).length).toBe(3)
  })
  it('narrows to one class', () => {
    expect(keep({ idClasses: new Set(['1b']) }).map((r) => r.sender_id)).toEqual(['77'])
  })
  it('unions several classes', () => {
    expect(keep({ idClasses: new Set(['1b', 'unnamed']) }).length).toBe(2)
  })
  it('counts as a narrowed filter, so the button lights up', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, idClasses: new Set(['1b']) })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, idClasses: new Set() })).toBe(false)
  })
})
