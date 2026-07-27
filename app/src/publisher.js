// Publishes buffered receptions to MQTT (over WebSocket/TLS) in the
// meshcoretomqtt-compatible format CoreScope's ingestor consumes, on the
// hunter topic meshcore/hunter/{rxPubkey}/packets.
import mqtt from 'mqtt';

// MQTT keepalive, in seconds. Explicit rather than mqtt.js's 60 s default:
// a missed PINGREQ is what flipped the status dot to "Not connected" while the
// main thread was saturated (#230), so the window this depends on should be a
// deliberate number in our code, not an undocumented library default.
export const KEEPALIVE_S = 30;

export class Publisher {
  // opts: { url, username, password } — EMQX WSS endpoint + per-client creds.
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

  // publish sends one reception; resolves on broker ack (QoS1).
  publish(rxPubkey, rec, name) {
    const topic = 'meshcore/hunter/' + rxPubkey + '/packets';
    const payload = JSON.stringify(Publisher.buildPayload(rxPubkey, rec, name));
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
  }
}
