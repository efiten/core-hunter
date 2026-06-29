// Runtime deployment config, fetched from config.json (served next to
// index.html) at startup. Nothing is baked into the bundle — sysops edit
// config.json, not source. See config.example.json for the shape.
let cfg = null;

// normalizeConfig validates + normalizes a parsed config.json object. Throws on
// a missing required field (mqttUrl). resolveUrl is optional (empty = node-name
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
  if (!c.mqttUrl) throw new Error('config.json: "mqttUrl" is required');

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
