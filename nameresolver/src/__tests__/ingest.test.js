import { describe, it, expect } from 'vitest'
import { handleMessage } from '../ingest.js'

// Same real advert fixture as advert.test.js, wrapped in the observer JSON envelope.
const ADVERT = '11007E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C94006CE7CF682E58408DD8FCC51906ECA98EBF94A037886BDADE7ECD09FD92B839491DF3809C9454F5286D1D3370AC31A34593D569E9A042A3B41FD331DFFB7E18599CE1E60992A076D50238C5B8F85757375354522F50756765744D65736820436F75676172'

function memStore() {
  const rows = new Map()
  return {
    rows,
    upsert: (rec) => rows.set(rec.pubkey, rec),
    resolvePrefix: () => [],
    loadCache: () => new Map(),
    close: () => {},
  }
}

describe('handleMessage', () => {
  it('decodes an advert envelope and upserts the name', () => {
    const store = memStore()
    const cache = new Map()
    const rec = handleMessage(Buffer.from(JSON.stringify({ raw: ADVERT })), { store, cache })
    expect(rec.name).toBe('WW7STR/PugetMesh Cougar')
    expect(store.rows.get(rec.pubkey).name).toBe('WW7STR/PugetMesh Cougar')
    expect(cache.get(rec.pubkey)).toEqual({ name: 'WW7STR/PugetMesh Cougar', lat: 47.543968, lon: -122.108616 })
  })

  it('is a no-op on the second identical advert (write-gate)', () => {
    const store = memStore()
    const cache = new Map()
    handleMessage(Buffer.from(JSON.stringify({ raw: ADVERT })), { store, cache })
    let writes = 0
    const spyStore = { ...store, upsert: () => { writes++ } }
    handleMessage(Buffer.from(JSON.stringify({ raw: ADVERT })), { store: spyStore, cache })
    expect(writes).toBe(0)
  })

  it('returns null for malformed JSON, missing raw, or a non-advert', () => {
    const deps = { store: memStore(), cache: new Map() }
    expect(handleMessage(Buffer.from('not json'), deps)).toBeNull()
    expect(handleMessage(Buffer.from(JSON.stringify({ nope: 1 })), deps)).toBeNull()
    expect(handleMessage(Buffer.from(JSON.stringify({ raw: 'zz' })), deps)).toBeNull()
  })
})
