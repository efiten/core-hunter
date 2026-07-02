import mqtt from 'mqtt'
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder'
import { extractAdvert } from './advert.js'
import { gateDecision } from './writegate.js'

// handleMessage processes one MQTT payload. The observer envelope is JSON with
// a hex packet in `raw`. Returns the written record or null (dropped).
export function handleMessage(payloadBuf, { store, cache }) {
  let msg
  try {
    msg = JSON.parse(payloadBuf.toString())
  } catch {
    return null
  }
  const rawHex = typeof msg?.raw === 'string' ? msg.raw : ''
  if (!rawHex) return null

  let decoded
  try {
    decoded = MeshCoreDecoder.decode(rawHex)
  } catch {
    return null
  }
  const rec = extractAdvert(decoded)
  if (!rec) return null

  const prev = cache.get(rec.pubkey)
  if (!gateDecision(prev, rec)) return null

  store.upsert(rec)
  cache.set(rec.pubkey, { name: rec.name, lat: rec.lat, lon: rec.lon })
  return rec
}

// startIngest connects to the broker and routes every message through
// handleMessage. Subscribes at QoS 0 (names don't need delivery guarantees).
export function startIngest(cfg, { store, cache }) {
  const client = mqtt.connect(cfg.mqttUrl, {
    username: cfg.mqttUsername,
    password: cfg.mqttPassword,
  })
  client.on('connect', () => {
    for (const t of cfg.topics) client.subscribe(t, { qos: 0 })
  })
  client.on('message', (_topic, payload) => {
    try {
      handleMessage(payload, { store, cache })
    } catch {
      // one bad packet must not kill the stream
    }
  })
  client.on('error', (e) => {
    console.error('nameresolver: mqtt error:', e.message)
  })
  return client
}
