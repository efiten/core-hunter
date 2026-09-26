import { describe, it, expect } from 'vitest'
import { pruneFloor, owedBrokers, dotState, parseBrokerPrefs, mergeBrokers, validateBroker, brokerStatus, probeBroker, mqttSummary, presetsFrom } from '../brokers.js'

describe('pruneFloor: how far retention may delete (#554)', () => {
  it('stops at the broker that is furthest behind', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 120 }])).toBe(120)
  })

  it('holds everything while one broker has received nothing', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 0 }])).toBe(0)
  })

  // Nothing is owed to anyone, so age alone decides. owedBrokers never hands
  // over an empty list while a broker is configured, and config.js requires one.
  it('lets age decide when no broker is owed', () => {
    expect(pruneFloor([])).toBe(Infinity)
  })
})

describe('owedBrokers: whose watermark holds retention back (#554)', () => {
  const site = { id: 'default', enabled: true }
  const dmc = { id: 'user:dmc.example', enabled: false }

  // A paused broker keeps its backlog for the retention window, not beyond it:
  // counting it would grow the store for as long as the switch stays off,
  // which is the unbounded store #230 removed (#671 review).
  it('owes only the brokers that are on while one is', () => {
    expect(owedBrokers([site, dmc])).toEqual([site])
  })

  // Nothing leaves the phone, so nothing unsent is pruned: the same as a phone
  // with no broker configured, whose watermark never moved.
  it('owes every broker while none is on', () => {
    const paused = { ...site, enabled: false }
    expect(owedBrokers([paused, dmc])).toEqual([paused, dmc])
  })
})

describe('dotState: one dot for several brokers (#554)', () => {
  it('is on when every broker is connected', () => {
    expect(dotState([true, true])).toBe('on')
  })

  it('is partial when one is missing', () => {
    expect(dotState([true, false])).toBe('partial')
  })

  it('is off when none is connected, or none is on', () => {
    expect(dotState([false, false])).toBe('off')
    expect(dotState([])).toBe('off')
  })
})

describe('parseBrokerPrefs: what the phone remembers (#554)', () => {
  it('reads back what was stored', () => {
    const stored = JSON.stringify({ added: [{ id: 'user:be.example', name: 'BE', url: 'wss://be.example', username: 'h', password: 's' }], off: ['default'] })
    expect(parseBrokerPrefs(stored)).toEqual({ added: [{ id: 'user:be.example', name: 'BE', url: 'wss://be.example', username: 'h', password: 's' }], off: ['default'] })
  })

  it('falls back to nothing added and nothing off on anything unreadable', () => {
    const empty = { added: [], off: [] }
    expect(parseBrokerPrefs(null)).toEqual(empty)
    expect(parseBrokerPrefs('{not json')).toEqual(empty)
    expect(parseBrokerPrefs('"a string"')).toEqual(empty)
    expect(parseBrokerPrefs(JSON.stringify({ added: 'x', off: 3 }))).toEqual(empty)
  })

  it('drops a stored broker without a url rather than connecting to nothing', () => {
    const stored = JSON.stringify({ added: [{ id: 'user:x', name: 'X' }], off: [] })
    expect(parseBrokerPrefs(stored).added).toEqual([])
  })
})

describe('mergeBrokers: the list the sheet shows (#554)', () => {
  const site = [{ id: 'default', name: 'Own', url: 'wss://own.example' }, { id: 'dmc', name: 'DMC', url: 'wss://dmc.example' }]
  const added = [{ id: 'user:be.example', name: 'BE', url: 'wss://be.example' }]

  it('lists the site\'s brokers first, then the ones added on this phone', () => {
    const list = mergeBrokers(site, { added, off: [] })
    expect(list.map((b) => [b.id, b.source])).toEqual([['default', 'site'], ['dmc', 'site'], ['user:be.example', 'user']])
  })

  it('has every broker on unless the hunter switched it off', () => {
    const list = mergeBrokers(site, { added, off: ['dmc'] })
    expect(list.map((b) => b.enabled)).toEqual([true, false, true])
  })

  it('lets the site win when an added broker reuses one of its ids', () => {
    const list = mergeBrokers(site, { added: [{ id: 'dmc', name: 'Mine', url: 'wss://mine.example' }], off: [] })
    expect(list.filter((b) => b.id === 'dmc').map((b) => b.url)).toEqual(['wss://dmc.example'])
  })
})

describe('validateBroker: the add form (#554)', () => {
  const ok = { name: 'BE community', url: 'wss://mqtt.be.example:443', username: 'hunter', password: 'secret' }

  it('turns a filled-in form into a broker keyed by its host', () => {
    expect(validateBroker(ok, [])).toEqual({
      ok: true,
      errors: {},
      broker: { id: 'user:mqtt.be.example', name: 'BE community', url: 'wss://mqtt.be.example:443', username: 'hunter', password: 'secret', format: 'wardrive' },
    })
  })

  it('names the broker after its host when the name is left empty', () => {
    expect(validateBroker({ ...ok, name: '  ' }, []).broker.name).toBe('mqtt.be.example')
  })

  it('refuses an address that is not a WebSocket address', () => {
    for (const url of ['', 'mqtt.be.example', 'https://mqtt.be.example', 'mqtt://mqtt.be.example:1883']) {
      const r = validateBroker({ ...ok, url }, [])
      expect(r.ok).toBe(false)
      expect(r.errors.url).toMatch(/wss:\/\//)
    }
  })

  // A page served over https cannot open a plain ws:// socket; the browser
  // blocks it without a usable error, so say it before the attempt.
  it('refuses plain ws:// on a secure page, and allows it on a local one', () => {
    expect(validateBroker({ ...ok, url: 'ws://mqtt.be.example' }, [], { securePage: true }).errors.url).toMatch(/wss:\/\//)
    expect(validateBroker({ ...ok, url: 'ws://localhost:1883' }, [], { securePage: false }).ok).toBe(true)
  })

  // Two brokers on one machine differ only in their port, and each needs its
  // own watermark.
  it('keys a broker on a non-default port by host and port', () => {
    expect(validateBroker({ ...ok, url: 'wss://mqtt.be.example:8084/mqtt' }, []).broker.id).toBe('user:mqtt.be.example:8084')
  })

  it('keeps no username or password for a broker the companion signs in to', () => {
    const r = validateBroker({ ...ok, auth: 'companion' }, [])
    expect(r.broker).toEqual({ id: 'user:mqtt.be.example', name: 'BE community', url: 'wss://mqtt.be.example:443', auth: 'companion', format: 'wardrive' })
  })

  // A broker a hunter adds is there to put them on someone's map, so wardrive
  // is what it gets unless the form says packets.
  it('gives an added broker the wardrive format unless packets was chosen', () => {
    expect(validateBroker(ok, []).broker.format).toBe('wardrive')
    expect(validateBroker({ ...ok, format: 'wardrive' }, []).broker.format).toBe('wardrive')
    expect('format' in validateBroker({ ...ok, format: 'packets' }, []).broker).toBe(false)
  })

  it('refuses a broker that is already in the list', () => {
    const r = validateBroker(ok, ['default', 'user:mqtt.be.example'])
    expect(r.ok).toBe(false)
    expect(r.errors.url).toMatch(/already/)
  })
})

describe('brokerStatus: one line per broker (#554)', () => {
  it('says Off for a broker that is switched off, whatever the socket does', () => {
    expect(brokerStatus({ enabled: false, connected: true, queued: 9 })).toEqual({ dot: 'off', text: 'Off' })
  })

  // A broker the companion signs in to cannot connect until the radio has
  // signed once. That is a thing to do, so it says what.
  it('says what it is waiting for when the companion has to sign first', () => {
    expect(brokerStatus({ enabled: true, connected: false, queued: 0, needsCompanion: true })).toEqual({ dot: 'warn', text: 'Connect your companion to sign in' })
  })

  it('says Connected when nothing is waiting', () => {
    expect(brokerStatus({ enabled: true, connected: true, queued: 0 })).toEqual({ dot: 'on', text: 'Connected' })
  })

  it('shows what a connected broker is still owed', () => {
    expect(brokerStatus({ enabled: true, connected: true, queued: 1200 })).toEqual({ dot: 'on', text: 'Connected · 1,200 queued' })
  })

  it('warns when receptions are waiting for a broker that is not connected', () => {
    expect(brokerStatus({ enabled: true, connected: false, queued: 214 })).toEqual({ dot: 'warn', text: 'Not connected · 214 queued' })
  })

  // With no companion and nothing owed the app keeps no connection open
  // (mqttlifecycle.js), and that is not a fault to flag in amber.
  it('stays quiet when a broker is not connected and nothing is waiting', () => {
    expect(brokerStatus({ enabled: true, connected: false, queued: 0 })).toEqual({ dot: 'off', text: 'Not connected' })
  })
})

describe('probeBroker: connect before saving (#554)', () => {
  const fake = (connect) => { const p = { ended: 0, connect, end() { p.ended++ } }; return p }

  it('reports a broker that accepts the connection, and hangs up again', async () => {
    const p = fake(() => Promise.resolve())
    expect(await probeBroker(p, 50)).toEqual({ ok: true })
    expect(p.ended).toBe(1)
  })

  it('reports a refused connection, and hangs up so mqtt.js stops retrying', async () => {
    const p = fake(() => Promise.reject(new Error('Not authorized')))
    expect(await probeBroker(p, 50)).toEqual({ ok: false, reason: 'Not authorized' })
    expect(p.ended).toBe(1)
  })

  // A wrong host does not fail, it just never answers.
  it('gives up on a broker that never answers', async () => {
    const p = fake(() => new Promise(() => {}))
    expect(await probeBroker(p, 20)).toEqual({ ok: false, reason: 'No answer' })
    expect(p.ended).toBe(1)
  })
})

describe('mqttSummary: the MQTT line in the Status tab (#554)', () => {
  it('keeps the old wording while there is one broker', () => {
    expect(mqttSummary([true])).toBe('Connected')
    expect(mqttSummary([false])).toBe('Not connected')
  })

  it('counts once there are several', () => {
    expect(mqttSummary([true, true, false])).toBe('2 of 3 connected')
    expect(mqttSummary([true, true])).toBe('Connected')
    expect(mqttSummary([false, false])).toBe('Not connected')
  })

  it('says so when every broker is switched off', () => {
    expect(mqttSummary([])).toBe('All brokers off')
  })
})

// The presets come from config.json since the review of #671 (the site names
// the public brokers it invites its hunters to feed, with the stream label
// each acknowledges), so no third party's host is committed in code.
describe('presetsFrom', () => {
  it('reads the usable entries and fills what a preset may leave out', () => {
    expect(presetsFrom({ brokerPresets: [
      { key: 'c1', name: 'Collector 1', url: 'wss://c1.example:443', auth: 'companion', format: 'wardrive', label: 'wardriver' },
      { key: 'c2', url: 'wss://c2.example:443' },
    ] })).toEqual([
      { key: 'c1', name: 'Collector 1', url: 'wss://c1.example:443', auth: 'companion', format: 'wardrive', label: 'wardriver' },
      { key: 'c2', name: 'c2.example', url: 'wss://c2.example:443', auth: 'companion', format: 'wardrive', label: null },
    ])
  })
  it('leaves out what cannot be a broker, and a second entry under one key', () => {
    expect(presetsFrom({ brokerPresets: [
      { key: '', url: 'wss://x.example' }, { key: 'h', url: 'https://x.example' }, 'nope', null,
      { key: 'k', url: 'wss://a.example' }, { key: 'k', url: 'wss://b.example' },
    ] })).toEqual([{ key: 'k', name: 'a.example', url: 'wss://a.example', auth: 'companion', format: 'wardrive', label: null }])
  })
  // The scheme alone is not an address. Without a name the hostname lookup
  // threw, and buildSettingsSheet with it; with a name the entry was shown
  // and then refused by the form (#671 review).
  it('leaves out an address that starts right and does not parse, named or not', () => {
    expect(presetsFrom({ brokerPresets: [
      { key: 'x', url: 'wss://' }, { key: 'y', name: 'Named', url: 'wss://:443' },
      { key: 'k', url: 'wss://a.example' },
    ] })).toEqual([{ key: 'k', name: 'a.example', url: 'wss://a.example', auth: 'companion', format: 'wardrive', label: null }])
  })
  // DMC has two production labels, hunter for a hunt and wardriver for a
  // coverage drive, and each collector takes both, so a site lists every
  // collector once per label: one address, two presets.
  it('offers one address under each label it is listed with', () => {
    expect(presetsFrom({ brokerPresets: [
      { key: 'c1-hunter', name: 'Collector 1 · hunter', url: 'wss://c1.example:443', label: 'hunter' },
      { key: 'c1-wardriver', name: 'Collector 1 · wardriver', url: 'wss://c1.example:443', label: 'wardriver' },
    ] }).map((p) => [p.key, p.label])).toEqual([['c1-hunter', 'hunter'], ['c1-wardriver', 'wardriver']])
  })
  it('is empty without config, or without the key', () => {
    expect(presetsFrom(null)).toEqual([])
    expect(presetsFrom({})).toEqual([])
    expect(presetsFrom({ brokerPresets: 'x' })).toEqual([])
  })
})

describe('validateBroker carries a preset\'s label', () => {
  it('keeps the label the form hands over, and none when there is none', () => {
    const withLabel = validateBroker({ url: 'wss://c1.example:443', auth: 'companion', label: 'wardriver' }, [])
    expect(withLabel.broker.label).toBe('wardriver')
    const without = validateBroker({ url: 'wss://c1.example:443', auth: 'companion', label: null }, [])
    expect('label' in without.broker).toBe(false)
  })
})

describe('brokerStatus tells a refusing companion from an absent one', () => {
  it('says the companion could not sign in when the sign request was refused', () => {
    expect(brokerStatus({ enabled: true, connected: false, queued: 0, signRefused: true })).toEqual({ dot: 'warn', text: 'Your companion could not sign in' })
    expect(brokerStatus({ enabled: true, connected: false, queued: 0, needsCompanion: true })).toEqual({ dot: 'warn', text: 'Connect your companion to sign in' })
  })
})
