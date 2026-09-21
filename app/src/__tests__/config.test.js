import { describe, it, expect } from 'vitest'
import { normalizeConfig } from '../config.js'

const BASE = { mqttUrl: 'mqtt://test' }

describe('normalizeConfig — resolvers array', () => {
  it('keeps a valid resolvers array, filtering entries without a string url', () => {
    const raw = {
      ...BASE,
      resolvers: [
        { label: 'BE', sf: 8, url: 'https://be.example.com/resolve' },
        { label: 'NL', sf: 7, url: 'https://nl.example.com/resolve' },
        { sf: 8 }, // no url — should be filtered out
        { url: 42 }, // url not a string — filtered
      ],
    }
    const c = normalizeConfig(raw)
    expect(c.resolvers).toHaveLength(2)
    expect(c.resolvers[0]).toEqual({ label: 'BE', sf: 8, url: 'https://be.example.com/resolve' })
    expect(c.resolvers[1]).toEqual({ label: 'NL', sf: 7, url: 'https://nl.example.com/resolve' })
  })

  it('back-compat: synthesizes a one-element resolvers from resolveUrl when no resolvers array', () => {
    const raw = { ...BASE, resolveUrl: 'https://legacy.example.com/resolve' }
    const c = normalizeConfig(raw)
    expect(c.resolvers).toHaveLength(1)
    expect(c.resolvers[0]).toEqual({ url: 'https://legacy.example.com/resolve' })
    // resolveUrl is still present on config
    expect(c.resolveUrl).toBe('https://legacy.example.com/resolve')
  })

  it('yields resolvers:[] when neither resolvers nor resolveUrl is present', () => {
    const c = normalizeConfig(BASE)
    expect(c.resolvers).toEqual([])
  })

  it('yields resolvers:[] when resolvers is present but all entries lack a string url', () => {
    const raw = { ...BASE, resolvers: [{ sf: 8 }, { label: 'X' }] }
    const c = normalizeConfig(raw)
    expect(c.resolvers).toEqual([])
  })
})

describe('normalizeConfig channels', () => {
  it('normalizes channels: prepends #, dedups, drops non-strings', () => {
    const c = normalizeConfig({ mqttUrl: 'wss://x/ws', channels: ['#chat', 'test', '#chat', 5, ' #weer '] })
    expect(c.channels).toEqual(['#chat', '#test', '#weer'])
  })
  it('channels defaults to [] when absent/invalid', () => {
    expect(normalizeConfig({ mqttUrl: 'wss://x/ws' }).channels).toEqual([])
    expect(normalizeConfig({ mqttUrl: 'wss://x/ws', channels: 'nope' }).channels).toEqual([])
  })
})

describe('normalizeConfig channelKeys', () => {
  it('keeps a hex channelKeys map, lowercased', () => {
    const c = normalizeConfig({ mqttUrl: 'wss://x/ws', channelKeys: { public: '8B3387E9C5CDEA6AC9E5EDBAA115CD72' } })
    expect(c.channelKeys).toEqual({ public: '8b3387e9c5cdea6ac9e5edbaa115cd72' })
  })
  it('defaults to empty object when absent or malformed', () => {
    expect(normalizeConfig({ mqttUrl: 'wss://x/ws' }).channelKeys).toEqual({})
    expect(normalizeConfig({ mqttUrl: 'wss://x/ws', channelKeys: { bad: 123 } }).channelKeys).toEqual({})
  })
  it('drops odd-length hex keys (cannot be parsed to bytes)', () => {
    const c = normalizeConfig({ mqttUrl: 'wss://x/ws', channelKeys: { bad: 'abc', good: '8b3387e9c5cdea6ac9e5edbaa115cd72' } })
    expect(c.channelKeys).toEqual({ good: '8b3387e9c5cdea6ac9e5edbaa115cd72' })
  })
})

describe('normalizeConfig brokers (#554)', () => {
  it('turns the single-broker fields into the first broker', () => {
    const c = normalizeConfig({ mqttUrl: 'wss://own.example/ws', mqttUsername: 'u', mqttPassword: 'p' })
    expect(c.brokers).toEqual([{ id: 'default', name: 'Mesh-Hunter', url: 'wss://own.example/ws', username: 'u', password: 'p' }])
  })

  it('appends the brokers array after it, in order', () => {
    const c = normalizeConfig({
      mqttUrl: 'wss://own.example/ws',
      brokers: [{ id: 'be', name: 'BE community', url: 'wss://be.example:443', username: 'h', password: 's' }],
    })
    expect(c.brokers.map((b) => b.id)).toEqual(['default', 'be'])
    expect(c.brokers[1]).toEqual({ id: 'be', name: 'BE community', url: 'wss://be.example:443', username: 'h', password: 's' })
  })

  it('accepts a brokers array on its own, without mqttUrl', () => {
    const c = normalizeConfig({ brokers: [{ id: 'be', url: 'wss://be.example' }] })
    expect(c.brokers.map((b) => b.id)).toEqual(['be'])
  })

  it('still refuses a config with nowhere to publish', () => {
    expect(() => normalizeConfig({ brokers: [] })).toThrow(/mqttUrl/)
    expect(() => normalizeConfig({ brokers: [{ id: 'x' }] })).toThrow(/mqttUrl/)
  })

  it('names a broker after its host when the entry has no name or id', () => {
    const c = normalizeConfig({ brokers: [{ url: 'wss://be.example:443/mqtt' }] })
    expect(c.brokers[0].id).toBe('be.example')
    expect(c.brokers[0].name).toBe('be.example')
  })

  // The id is the key the watermark is stored under: two entries sharing one
  // would share progress, and the second would never get its own receptions.
  it('drops a second entry that reuses an id', () => {
    const c = normalizeConfig({ brokers: [{ id: 'a', url: 'wss://one.example' }, { id: 'a', url: 'wss://two.example' }] })
    expect(c.brokers.map((b) => b.url)).toEqual(['wss://one.example'])
  })

  it('reads how a broker is signed in to, and defaults to a password', () => {
    const c = normalizeConfig({ brokers: [
      { id: 'a', url: 'wss://a.example', auth: 'companion', username: 'ignored', password: 'ignored' },
      { id: 'b', url: 'wss://b.example', auth: 'nonsense' },
    ] })
    expect(c.brokers[0]).toEqual({ id: 'a', name: 'a.example', url: 'wss://a.example', auth: 'companion' })
    expect(c.brokers[1].auth).toBeUndefined()
  })
})
