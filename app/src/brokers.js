// Pure decisions about publishing to several brokers at once (#554). No DOM,
// no network, no IndexedDB -- app.js feeds these what it knows.

// pruneFloor is how far retention may delete: the watermark of the broker that
// is furthest behind. A reception is only safe to drop once every broker that
// is owed it has it. `brokers` are the ones that are ON: [{ id, watermark }].
// With none on, nothing is owed to anyone and age alone decides.
export function pruneFloor(brokers) {
  if (!brokers || brokers.length === 0) return Infinity
  return Math.min(...brokers.map((b) => b.watermark))
}

// dotState folds the brokers that are on into the one MQTT dot in the top bar.
// `connected` is one boolean per broker. 'partial' is the state a single dot
// could not show before: the socket to one broker is up while another is owed
// a backlog.
export function dotState(connected) {
  const up = (connected || []).filter(Boolean).length
  if (up === 0) return 'off'
  return up === connected.length ? 'on' : 'partial'
}

// ---- The hunter's own brokers (#554) ---------------------------------------
//
// config.json supplies the site's brokers. On top of that a hunter can add
// brokers of their own and switch any broker off; both are kept on the phone.

function usable(b) {
  return Boolean(b) && typeof b === 'object' && typeof b.url === 'string' && b.url.trim() !== '' && typeof b.id === 'string' && b.id !== ''
}

// parseBrokerPrefs reads the stored JSON. Anything unreadable is the same as
// nothing stored: no broker added, none switched off.
export function parseBrokerPrefs(stored) {
  let raw = null
  try { raw = JSON.parse(stored) } catch (_) { raw = null }
  if (!raw || typeof raw !== 'object') return { added: [], off: [] }
  return {
    added: Array.isArray(raw.added) ? raw.added.filter(usable) : [],
    off: Array.isArray(raw.off) ? raw.off.filter((id) => typeof id === 'string') : [],
  }
}

// mergeBrokers is the list the sheet shows and the drain walks: the site's
// brokers first, then the hunter's. `source` says who put it there, `enabled`
// whether receptions go to it. An id belongs to the site first, because its
// watermark does.
export function mergeBrokers(site, prefs) {
  const off = new Set((prefs && prefs.off) || [])
  const out = (site || []).map((b) => ({ ...b, source: 'site', enabled: !off.has(b.id) }))
  for (const b of (prefs && prefs.added) || []) {
    if (out.some((x) => x.id === b.id)) continue
    out.push({ ...b, source: 'user', enabled: !off.has(b.id) })
  }
  return out
}

// validateBroker turns the add form into a broker, or into the message to put
// under the field. `securePage` is whether the app itself is served over
// https: a secure page cannot open a plain ws:// socket, and the browser
// blocks it without an error worth showing.
export function validateBroker(form, existingIds, { securePage = true } = {}) {
  const url = String((form && form.url) || '').trim()
  let parsed = null
  try { parsed = new URL(url) } catch (_) { parsed = null }
  const scheme = parsed ? parsed.protocol : ''
  if (!parsed || !parsed.hostname || (scheme !== 'wss:' && scheme !== 'ws:') || (scheme === 'ws:' && securePage)) {
    return { ok: false, errors: { url: 'Use a WebSocket address that starts with wss://' }, broker: null }
  }
  // host, not hostname: it carries a non-default port, and two brokers on one
  // machine each need their own watermark.
  const id = 'user:' + parsed.host
  if ((existingIds || []).includes(id)) {
    return { ok: false, errors: { url: 'This broker is already in the list.' }, broker: null }
  }
  const broker = { id, name: String(form.name || '').trim() || parsed.hostname, url }
  if (form.auth === 'companion') broker.auth = 'companion'
  else {
    broker.username = String(form.username || '').trim()
    broker.password = form.password == null ? '' : String(form.password)
  }
  if (form.format !== 'packets') broker.format = 'wardrive'
  // A preset's stream label rides with the broker (presetsFrom); a broker
  // without one publishes on the default label.
  if (typeof form.label === 'string' && form.label.trim()) broker.label = form.label.trim()
  return { ok: true, errors: {}, broker }
}

// brokerStatus is the one line under a broker's name.
export function brokerStatus({ enabled, connected, queued, needsCompanion = false, signRefused = false }) {
  if (!enabled) return { dot: 'off', text: 'Off' }
  if (!connected && signRefused) return { dot: 'warn', text: 'Your companion could not sign in' }
  if (!connected && needsCompanion) return { dot: 'warn', text: 'Connect your companion to sign in' }
  const n = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0
  const waiting = n > 0 ? ` · ${n.toLocaleString('en')} queued` : ''
  // Amber means receptions are waiting. Not connected with nothing owed is the
  // resting state without a companion, not a fault.
  const dot = connected ? 'on' : (n > 0 ? 'warn' : 'off')
  return { dot, text: (connected ? 'Connected' : 'Not connected') + waiting }
}

// probeBroker tries a connection before a broker is saved, so a typo in the
// address shows up in the form instead of as a dot that never lights. The
// publisher is always ended: mqtt.js would otherwise keep retrying a broker
// that was never saved. A wrong host does not fail, it never answers, hence
// the timeout.
export async function probeBroker(publisher, timeoutMs = 8000) {
  let timer = null
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, reason: 'No answer' }), timeoutMs) })
  const attempt = publisher.connect().then(() => ({ ok: true }), (e) => ({ ok: false, reason: (e && e.message) || 'Refused' }))
  try {
    return await Promise.race([attempt, timeout])
  } finally {
    clearTimeout(timer)
    publisher.end()
  }
}

// mqttSummary is the state text next to "MQTT" in the Status tab. `connected`
// is one boolean per broker that is on.
export function mqttSummary(connected) {
  const flags = connected || []
  if (flags.length === 0) return 'All brokers off'
  const up = flags.filter(Boolean).length
  if (up === flags.length) return 'Connected'
  return up === 0 ? 'Not connected' : `${up} of ${flags.length} connected`
}

// Brokers the add form can start from, from config.json (`brokerPresets`):
// the site names the public brokers it invites its hunters to feed, with the
// stream label those brokers acknowledge. A preset carries no credential:
// `auth: 'companion'` signs in with the companion's key. In config.json rather
// than in code, so no third party's host is committed here (AGENTS.md, "No
// secrets in the repo"); an unusable entry is left out rather than shown.
export function presetsFrom(cfg) {
  const raw = cfg && Array.isArray(cfg.brokerPresets) ? cfg.brokerPresets : []
  const out = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const key = typeof p.key === 'string' && p.key.trim() ? p.key.trim() : null
    const url = typeof p.url === 'string' ? p.url.trim() : ''
    if (!key || !/^wss?:\/\//.test(url) || out.some((x) => x.key === key)) continue
    out.push({
      key,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : new URL(url).hostname,
      url,
      auth: p.auth === 'password' ? 'password' : 'companion',
      format: p.format === 'packets' ? 'packets' : 'wardrive',
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null,
    })
  }
  return out
}
