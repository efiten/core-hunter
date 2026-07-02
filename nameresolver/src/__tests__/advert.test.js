import { describe, it, expect } from 'vitest'
import { MeshCoreDecoder, PayloadType } from '@michaelhart/meshcore-decoder'
import { extractAdvert } from '../advert.js'

// Real ADVERT packet (decoder test fixture): repeater with name + location.
const ADVERT = '11007E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C94006CE7CF682E58408DD8FCC51906ECA98EBF94A037886BDADE7ECD09FD92B839491DF3809C9454F5286D1D3370AC31A34593D569E9A042A3B41FD331DFFB7E18599CE1E60992A076D50238C5B8F85757375354522F50756765744D65736820436F75676172'

describe('extractAdvert', () => {
  it('extracts pubkey + name + location from a real advert', () => {
    const rec = extractAdvert(MeshCoreDecoder.decode(ADVERT))
    expect(rec).toEqual({
      pubkey: '7e7662676f7f0850a8a355baafbfc1eb7b4174c340442d7d7161c9474a2c9400',
      name: 'WW7STR/PugetMesh Cougar',
      lat: 47.543968,
      lon: -122.108616,
    })
  })

  it('returns null for a non-advert payload', () => {
    // A decoded object whose payloadType is not Advert.
    const fake = { payloadType: PayloadType.TextMessage ?? 0, payload: { decoded: {} } }
    expect(extractAdvert(fake)).toBeNull()
  })

  it('returns null for an advert with no name', () => {
    const fake = {
      payloadType: PayloadType.Advert,
      payload: { decoded: { publicKey: 'AABB', appData: { hasName: false } } },
    }
    expect(extractAdvert(fake)).toBeNull()
  })

  it('returns null lat/lon for an advert without a location', () => {
    const fake = {
      payloadType: PayloadType.Advert,
      payload: { decoded: { publicKey: 'AABBCCDD'.repeat(8), appData: { hasName: true, name: 'x', hasLocation: false } } },
    }
    expect(extractAdvert(fake)).toEqual({ pubkey: 'aabbccdd'.repeat(8), name: 'x', lat: null, lon: null })
  })

  it('returns null when the pubkey is not hex', () => {
    const fake = {
      payloadType: PayloadType.Advert,
      payload: { decoded: { publicKey: 'not-hex!', appData: { hasName: true, name: 'x' } } },
    }
    expect(extractAdvert(fake)).toBeNull()
  })
})
