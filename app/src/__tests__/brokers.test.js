import { describe, it, expect } from 'vitest'
import { pruneFloor, dotState, parseBrokerPrefs, mergeBrokers, validateBroker, brokerStatus, probeBroker, mqttSummary } from '../brokers.js'

describe('pruneFloor: how far retention may delete (#554)', () => {
  it('stops at the broker that is furthest behind', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 120 }])).toBe(120)
  })

  it('holds everything while one broker has received nothing', () => {
    expect(pruneFloor([{ id: 'default', watermark: 900 }, { id: 'dmc', watermark: 0 }])).toBe(0)
  })

  // Nothing is owed to anyone, so age alone decides. Without this a hunter who
  // switched every broker off would keep every reception forever.
  it('lets age decide when no broker is on', () => {
    expect(pruneFloor([])).toBe(Infinity)
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
