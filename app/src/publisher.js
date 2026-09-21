// Publishes buffered receptions to MQTT (over WebSocket/TLS) in the
// meshcoretomqtt-compatible format CoreScope's ingestor consumes, on the
// hunter topic meshcore/hunter/{rxPubkey}/packets.
import mqtt from 'mqtt';
import { buildObs, buildTrack, obsTopic, trackTopic } from './wardrive.js';

// MQTT keepalive, in seconds. Explicit rather than mqtt.js's 60 s default:
// a missed PINGREQ is what flipped the status dot to "Not connected" while the
// main thread was saturated (#230), so the window this depends on should be a
// deliberate number in our code, not an undocumented library default.
export const KEEPALIVE_S = 30;

// How long a publish may wait for its PUBACK. Twice the drain tick.
export const ACK_TIMEOUT_MS = 10_000;

// The stream label in a wardrive topic: meshcore/{label}/{PUBKEY}/wardriver/...
const DEFAULT_LABEL = 'hunter';

export class Publisher {
  // opts: { url, username, password, clientId } for the connection, and
  // { format, label } for what is sent: 'packets' (default) or 'wardrive'.
  constructor(opts) { this.opts = opts; this.client = null; }

  connect() {
    this.client = mqtt.connect(this.opts.url, {
      username: this.opts.username,
      password: this.opts.password,
      clientId: this.opts.clientId, // = companion pubkey; EMQX ACL can bind topics to ${clientid}
      reconnectPeriod: 4000,
      keepalive: KEEPALIVE_S,
      clean: true,
    });
    return new Promise((resolve, reject) => {
      this.client.once('connect', resolve);
      this.client.once('error', reject);
    });
  }

  connected() { return !!(this.client && this.client.connected); }

  end() { try { if (this.client) this.client.end(true); } catch (e) {} this.client = null; }

  // buildPayload assembles one reception in the ingestor's expected shape.
  // `name` is the companion's self-reported name (SELF_INFO) → sent as "origin"
  // so the server can label this observer even if it never advertised.
  static buildPayload(rxPubkey, rec, name) {
    return {
      origin_id: rxPubkey,
      origin: name || undefined,
      timestamp: rec.rx_at,
      type: 'PACKET',
      direction: 'rx',
      raw: rec.raw,
      SNR: rec.snr,
      RSSI: rec.rssi,
      is_direct: rec.is_direct,
      hops: rec.hops,
      sender_kind: rec.sender_kind,
      sender_id: rec.sender_id,
      sender_label: rec.sender_label,
      sender_role: rec.sender_role,
      channel_name: rec.channel_name,
      packet_type: rec.packet_type,
      gps: { lat: rec.lat, lon: rec.lon, acc_m: rec.acc_m },
    };
  }

  // send resolves on the broker's ack (QoS 1) and gives up after ackTimeoutMs.
  // A broker that accepts the connection but drops the message sends no
  // PUBACK, and mqtt.js then never calls back: with several brokers that would
  // hold the drain, and every other broker with it, for ever (#554).
  send(topic, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('publish not acknowledged')), this.opts.ackTimeoutMs || ACK_TIMEOUT_MS);
      this.client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      });
    });
  }

  // publish sends one reception.
  // The row's own pubkey wins over the caller's: a reception belongs to the
  // companion that heard it, and the backlog may outlive that BLE session
  // (#454). The argument stays as the fallback for rows queued before the
  // stamp existed.
  //
  // A broker in the wardrive format (#554) gets the reception as an obs. One
  // whose frame cannot be hashed is passed over: without the hash a consumer
  // cannot join it to anything, and failing would block the queue behind it.
  async publish(rxPubkey, rec, name) {
    const owner = (rec && rec.rx_pubkey) || rxPubkey;
    if (this.opts.format === 'wardrive') {
      const obs = await buildObs(rec, { originId: String(owner).toUpperCase(), pubAt: new Date().toISOString() });
      if (!obs) return undefined;
      return this.send(obsTopic(this.opts.label || DEFAULT_LABEL, owner), obs);
    }
    return this.send('meshcore/hunter/' + owner + '/packets', Publisher.buildPayload(owner, rec, name));
  }

  // publishTrack sends one stored listening interval (wardrive format only).
  publishTrack(row) {
    const track = buildTrack({
      originId: String(row.rx_pubkey).toUpperCase(),
      t0: row.t0, t1: row.t1, lat: row.lat, lon: row.lon, accM: row.acc_m,
      rxCount: row.rx_count, listening: row.listening,
    });
    return this.send(trackTopic(this.opts.label || DEFAULT_LABEL, row.rx_pubkey), track);
  }
}
