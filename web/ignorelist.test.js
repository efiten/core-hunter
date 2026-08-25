import { describe, it, expect } from 'vitest'
import { IGNORE_KEY, loadIgnore, saveIgnore, toggleIgnore, isIgnored, ignoreParams } from './ignorelist.js'

// A minimal localStorage stand-in. `fail` makes setItem throw the way a full
// or blocked quota does, which is the case saveIgnore reports on.
const fakeStorage = ({ initial, fail } = {}) => {
  let value = initial
  return {
    getItem: (k) => (k === IGNORE_KEY ? value ?? null : null),
    setItem: (k, v) => { if (fail) throw new Error('quota'); if (k === IGNORE_KEY) value = v },
    read: () => value,
  }
}

describe('loadIgnore', () => {
  it('reads a stored list, lower-cased', () => {
    expect(loadIgnore(fakeStorage({ initial: '["AA11","bb22"]' }))).toEqual(new Set(['aa11', 'bb22']))
  })
  it('treats every unreadable form as nothing ignored', () => {
    for (const initial of [null, '', 'not json', '{"a":1}', '"a string"', '42']) {
      expect(loadIgnore(fakeStorage({ initial })), String(initial)).toEqual(new Set())
    }
    expect(loadIgnore(undefined)).toEqual(new Set())
  })
  it('drops entries that are not usable ids', () => {
    expect(loadIgnore(fakeStorage({ initial: '["aa", "", "  ", null, 7, {}]' }))).toEqual(new Set(['aa']))
  })
})

describe('saveIgnore', () => {
  it('writes the list and reports success', () => {
    const s = fakeStorage()
    expect(saveIgnore(s, new Set(['aa', 'bb']))).toBe(true)
    expect(JSON.parse(s.read())).toEqual(['aa', 'bb'])
  })
  // The UI has already drawn the change by then, so a caller that cannot tell
  // would leave the user with a list that quietly empties on reload.
  it('reports failure when storage refuses the write', () => {
    expect(saveIgnore(fakeStorage({ fail: true }), new Set(['aa']))).toBe(false)
  })
})

describe('toggleIgnore — a node, not an id', () => {
  // #331: one physical node is heard under up to three prefixes. Ignoring one
  // of them would leave the same node on the map under the other two.
  it('adds every variant of a merged row at once', () => {
    expect(toggleIgnore(new Set(), ['aabb', 'aabbcc', 'aabbccdd'])).toEqual(new Set(['aabb', 'aabbcc', 'aabbccdd']))
  })
  it('removes every variant when any one of them is listed', () => {
    expect(toggleIgnore(new Set(['aabbcc']), ['aabb', 'aabbcc', 'aabbccdd'])).toEqual(new Set())
  })
  it('accepts a bare id as well as a group', () => {
    expect(toggleIgnore(new Set(), 'aa')).toEqual(new Set(['aa']))
  })
  it('lower-cases, so a picked row and a typed id agree', () => {
    expect(toggleIgnore(new Set(), ['AABB'])).toEqual(new Set(['aabb']))
  })
  it('leaves the input set untouched', () => {
    const before = new Set(['aa'])
    toggleIgnore(before, ['bb'])
    expect(before).toEqual(new Set(['aa']))
  })
})

describe('isIgnored', () => {
  it('matches on any variant of the node', () => {
    expect(isIgnored(new Set(['aabbcc']), ['aabb', 'aabbcc'])).toBe(true)
    expect(isIgnored(new Set(['ffff']), ['aabb', 'aabbcc'])).toBe(false)
  })
  it('is false for an empty or missing list', () => {
    expect(isIgnored(new Set(), ['aa'])).toBe(false)
    expect(isIgnored(undefined, ['aa'])).toBe(false)
  })
})

describe('ignoreParams', () => {
  // ?ignores=, not ?ignore=: the comma-separated ?ignore= belongs to the
  // operator config and keeps its meaning server-side.
  it('renders one repeated ?ignores= per id', () => {
    expect(ignoreParams(new Set(['aa', 'bb']))).toEqual([['ignores', 'aa'], ['ignores', 'bb']])
  })
  it('is empty for an empty list, so no ignore= reaches the query', () => {
    expect(ignoreParams(new Set())).toEqual([])
    expect(ignoreParams(undefined)).toEqual([])
  })
  // The #288 rule: sender_id is the decrypted display name for channel senders,
  // so it is arbitrary operator text. A comma-joined value would split "Bob, K."
  // into two ids that match other nodes, or nothing at all.
  it('never joins ids into one value, so a comma in a name survives', () => {
    const params = ignoreParams(new Set(['bob, k.', 'aa']))
    expect(params).toEqual([['ignores', 'bob, k.'], ['ignores', 'aa']])
    expect(params.every(([, v]) => !v.includes(','))).toBe(false) // the comma is INSIDE one id
    expect(params).toHaveLength(2)
  })
})
