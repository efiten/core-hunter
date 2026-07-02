import { describe, it, expect } from 'vitest'
import { normalizeConfig } from '../config.js'

describe('normalizeConfig', () => {
  const base = { mqttUrl: 'wss://b:8084/mqtt', mqttUsername: 'u', mqttPassword: 'p' }

  it('applies defaults for topics, httpPort, dbPath', () => {
    const c = normalizeConfig(base)
    expect(c.topics).toEqual(['meshcore/+/+/packets'])
    expect(c.httpPort).toBe(8090)
    expect(c.dbPath).toBe('/app/data/nameresolver.db')
  })

  it('keeps provided topics/httpPort/dbPath', () => {
    const c = normalizeConfig({ ...base, topics: ['meshcore/#'], httpPort: 3004, dbPath: '/tmp/x.db' })
    expect(c.topics).toEqual(['meshcore/#'])
    expect(c.httpPort).toBe(3004)
    expect(c.dbPath).toBe('/tmp/x.db')
  })

  it('throws when a required broker field is missing', () => {
    expect(() => normalizeConfig({ mqttUrl: 'wss://b', mqttUsername: 'u' })).toThrow(/mqttPassword/)
    expect(() => normalizeConfig({ mqttUsername: 'u', mqttPassword: 'p' })).toThrow(/mqttUrl/)
    expect(() => normalizeConfig(null)).toThrow(/JSON object/)
  })
})
