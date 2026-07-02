import { readFileSync } from 'node:fs'

// normalizeConfig validates + fills defaults. Throws on a missing required
// broker field. Pure (no fs) so it is unit-testable.
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config: expected a JSON object')
  }
  const mqttUrl = String(raw.mqttUrl || '').trim()
  if (!mqttUrl) throw new Error('config: "mqttUrl" is required')
  const mqttUsername = String(raw.mqttUsername || '').trim()
  if (!mqttUsername) throw new Error('config: "mqttUsername" is required')
  const mqttPassword = raw.mqttPassword == null ? '' : String(raw.mqttPassword)
  if (!mqttPassword) throw new Error('config: "mqttPassword" is required')

  const topics = Array.isArray(raw.topics) && raw.topics.length > 0
    ? raw.topics.filter((t) => typeof t === 'string' && t.length > 0)
    : ['meshcore/+/+/packets']
  const httpPort = typeof raw.httpPort === 'number' ? raw.httpPort : 8090
  const dbPath = String(raw.dbPath || '').trim() || '/app/data/nameresolver.db'

  return { mqttUrl, mqttUsername, mqttPassword, topics, httpPort, dbPath }
}

// loadConfig reads + parses config.json, then normalizes.
export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return normalizeConfig(raw)
}
