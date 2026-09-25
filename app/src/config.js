// Runtime deployment config, fetched from config.json (served next to
// index.html) at startup. Nothing is baked into the bundle — sysops edit
// config.json, not source. See config.example.json for the shape.
let cfg = null;

// normalizeConfig validates + normalizes a parsed config.json object. Throws when
// there is no broker to publish to (mqttUrl, or a brokers entry). resolveUrl is optional (empty = node-name
// resolution disabled).
// resolvers: array of { label?, sf?, url } for name resolution. Back-compat:
// a bare resolveUrl is synthesized into a one-element resolvers array.
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.json: expected a JSON object');
  const c = {
    mqttUrl: String(raw.mqttUrl || '').trim(),
    mqttUsername: String(raw.mqttUsername || '').trim(),
    mqttPassword: raw.mqttPassword == null ? '' : String(raw.mqttPassword),
    resolveUrl: String(raw.resolveUrl || '').trim(),
    rssiCalibrationOffset: typeof raw.rssiCalibrationOffset === 'number' ? raw.rssiCalibrationOffset : 0,
    resolvers: [],
    channelKeys: {},
  };
  // Brokers (#554): every reception goes to each of these. mqttUrl and its two
  // fields are the first one, under the id its watermark has always had; the
  // brokers array follows it. The id is what a broker's progress is stored
  // under, so a second entry reusing one is dropped rather than sharing it.
  c.brokers = [];
  const addBroker = (b) => {
    if (!b || typeof b.url !== 'string' || !b.url.trim()) return;
    const url = b.url.trim();
    let host = url;
    try { host = new URL(url).hostname || url; } catch (_) { /* keep the raw string as the name */ }
    const id = String(b.id || host).trim();
    if (c.brokers.some((x) => x.id === id)) return;
    // auth 'companion': no password, the companion signs a token with its own
    // key (companionsign.js). Anything else is a username and a password.
    const entry = { id, name: String(b.name || host).trim(), url };
    if (b.auth === 'companion') entry.auth = 'companion';
    else {
      entry.username = String(b.username || '').trim();
      entry.password = b.password == null ? '' : String(b.password);
    }
    // format 'wardrive': receptions go out as obs plus the phone's track
    // (wardrive.js), under a stream label. Anything else is the packets format.
    if (b.format === 'wardrive') {
      entry.format = 'wardrive';
      entry.label = String(b.label || 'hunter').trim().toLowerCase();
    }
    c.brokers.push(entry);
  };
  // The mqttUrl broker has no name field of its own; it is the app's own.
  if (c.mqttUrl) addBroker({ id: 'default', name: 'Mesh-Hunter', url: c.mqttUrl, username: c.mqttUsername, password: c.mqttPassword });
  if (Array.isArray(raw.brokers)) raw.brokers.forEach(addBroker);
  if (c.brokers.length === 0) throw new Error('config.json: "mqttUrl" or a "brokers" entry with a url is required');

  // Build normalized resolvers array.
  if (Array.isArray(raw.resolvers) && raw.resolvers.length > 0) {
    c.resolvers = raw.resolvers
      .filter(r => r && typeof r.url === 'string' && r.url.length > 0)
      .map(r => {
        const entry = { url: r.url };
        if (typeof r.label === 'string') entry.label = r.label;
        if (typeof r.sf === 'number') entry.sf = r.sf;
        return entry;
      });
  } else if (c.resolveUrl) {
    // Back-compat: single resolveUrl becomes a one-element resolvers array.
    c.resolvers = [{ url: c.resolveUrl }];
  }

  // Normalize channels: keep strings, trim, prepend '#' if missing, dedup preserving order.
  if (Array.isArray(raw.channels)) {
    const seen = new Set()
    c.channels = raw.channels
      .filter(v => typeof v === 'string')
      .map(v => { const s = v.trim(); return s.startsWith('#') ? s : '#' + s })
      .filter(v => { if (seen.has(v)) return false; seen.add(v); return true })
  } else {
    c.channels = []
  }

  if (raw.channelKeys && typeof raw.channelKeys === 'object' && !Array.isArray(raw.channelKeys)) {
    for (const [name, key] of Object.entries(raw.channelKeys)) {
      if (typeof key === 'string' && /^[0-9a-fA-F]+$/.test(key) && key.length > 0 && key.length % 2 === 0) {
        c.channelKeys[name] = key.toLowerCase();
      }
    }
  }

  return c;
}

// loadConfig fetches + normalizes config.json once and caches it. Throws if the
// file is missing/unreadable or invalid JSON.
export async function loadConfig(url = 'config.json') {
  if (cfg) return cfg;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('config.json not found (HTTP ' + r.status + ')');
  let raw;
  try { raw = await r.json(); } catch (e) { throw new Error('config.json: invalid JSON — ' + e.message); }
  cfg = normalizeConfig(raw);
  return cfg;
}

export function getConfig() { return cfg; }
export function setConfig(c) { cfg = c; } // test seam
