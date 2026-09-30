// Pure decisions about publishing to several brokers at once (#554). No DOM,
// no network, no IndexedDB -- app.js feeds these what it knows.

// pruneFloor is how far retention may delete: the watermark of the broker that
// is furthest behind. A reception is only safe to drop once every broker that
// is owed it has it. `brokers` are the owed ones (owedBrokers):
// [{ id, watermark }]. With none, nothing is owed to anyone and age alone
// decides.
export function pruneFloor(brokers) {
  if (!brokers || brokers.length === 0) return Infinity
  return Math.min(...brokers.map((b) => b.watermark))
}

// owedBrokers is whose watermark holds retention back. While a broker is on,
// only the brokers that are on: a paused one keeps its backlog for the
// retention window and not beyond, since counting it would grow the store for
// as long as its switch stays off (#230). With every broker off nothing leaves
// the phone, so all of them count and nothing unsent is pruned, as on a phone
// whose one broker never connected (#671 review).
export function owedBrokers(brokers) {
  const on = (brokers || []).filter((b) => b.enabled)
  return on.length ? on : (brokers || [])
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

// legsOf is the connections behind one row (#704). A broker with streams is
// one row and one switch, with a connection per stream, each to its own
// address under its own stream label. A connection's id is what its watermark
// and its companion token are stored under, so it carries the stream's host:
// the token is signed for one host. A broker without streams is its own one
// connection, under its own id.
export function legsOf(broker) {
  if (!broker) return []
  if (!Array.isArray(broker.streams) || broker.streams.length === 0) return [broker]
  const { streams, ...rest } = broker
  return streams.map((s) => ({ ...rest, id: broker.id + '@' + hostOf(s.url), url: s.url, label: s.label }))
}

// hostOf is a connection's host as URL.host has it: the port only when it is
// not the default one, like the user: ids validateBroker makes.
export function hostOf(url) {
  try { return new URL(url).host || url } catch (_) { return url }
}

// hostClashes names, per broker a hunter added, the site broker that already
// publishes to its host (#704): a preset added before the site row shares a
// host with it after the deploy. The companion's key is the client id on
// every broker it signs in to, and a second session under one id kicks the
// first, so the two would take turns for ever, and all the hunter sees is a
// row that blinks. The add form refuses a new one (validateBroker); this is
// for the one that is already there, on or off, so the row can say which of
// the two to remove.
export function hostClashes(brokers) {
  const site = new Map()
  for (const b of brokers || []) {
    if (b.source !== 'site') continue
    for (const leg of legsOf(b)) site.set(hostOf(leg.url), b.name)
  }
  const out = new Map()
  for (const b of brokers || []) {
    if (b.source !== 'user') continue
    const name = site.get(hostOf(b.url))
    if (name) out.set(b.id, name)
  }
  return out
}

// foldLegs is one status for a row of several connections (#704): connected
// when every connection is, queued as far as the one furthest behind (each
// drains on its own), and waiting on the companion when any of them is.
export function foldLegs(stats) {
  const s = stats || []
  const up = s.filter((x) => x.connected).length
  return {
    connected: s.length > 0 && up === s.length,
    up,
    of: s.length,
    queued: Math.max(0, ...s.map((x) => (Number.isFinite(x.queued) ? x.queued : 0))),
    needsCompanion: s.some((x) => x.needsCompanion),
    signRefused: s.some((x) => x.signRefused),
  }
}

// validateBroker turns the add form into a broker, or into the message to put
// under the field. `securePage` is whether the app itself is served over
// https: a secure page cannot open a plain ws:// socket, and the browser
// blocks it without an error worth showing.
export function validateBroker(form, existingIds, { securePage = true, takenHosts = [] } = {}) {
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
  // A host the site already publishes to is taken too (#704): the companion's
  // key is the client id on every broker it signs in to, and a second session
  // under one id kicks the first, so the two would take turns for ever.
  if ((existingIds || []).includes(id) || (takenHosts || []).includes(parsed.host)) {
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
export function brokerStatus({ enabled, connected, queued, needsCompanion = false, signRefused = false, up = null, of = null }) {
  if (!enabled) return { dot: 'off', text: 'Off' }
  const n = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0
  const waiting = n > 0 ? ` · ${n.toLocaleString('en')} queued` : ''
  // A row with several connections (#704) that has some of them up says how
  // many: one collector down is something to see, not a broker that is off.
  // The reason the others are down rides with the count.
  if (of > 1 && up > 0 && up < of) {
    const why = signRefused ? ' · your companion could not sign in' : needsCompanion ? ' · connect your companion to sign in' : ''
    return { dot: 'warn', text: `${up} of ${of} connected${why}${waiting}` }
  }
  if (!connected && signRefused) return { dot: 'warn', text: 'Your companion could not sign in' }
  if (!connected && needsCompanion) return { dot: 'warn', text: 'Connect your companion to sign in' }
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
    let parsed = null
    try { parsed = new URL(url) } catch (_) { parsed = null }
    const scheme = parsed ? parsed.protocol : ''
    if (!key || (scheme !== 'wss:' && scheme !== 'ws:') || !parsed.hostname || out.some((x) => x.key === key)) continue
    out.push({
      key,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : parsed.hostname,
      url,
      auth: p.auth === 'password' ? 'password' : 'companion',
      format: p.format === 'packets' ? 'packets' : 'wardrive',
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null,
    })
  }
  return out
}

// sharedWith is what the splash and About say about where receptions go
// (#704): every broker that is on, by name, so a site without DutchMeshCore or
// a hunter who switched it off does not read that it is there. With every
// broker off nothing leaves the phone yet.
export function sharedWith(names) {
  const n = [...new Set((names || []).filter(Boolean))]
  if (n.length === 0) return 'Your receptions stay on this phone.'
  const list = n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]
  return `Your receptions are shared with ${list}.`
}

// liveBrokers: the brokers that may connect. A broker a hunter added on a
// host a site broker publishes to (hostClashes) stays on its row, with the
// hint to remove it, and never connects: under the companion's key as its
// client id, the two sessions would keep signing each other out (#704).
export function liveBrokers(brokers) {
  const clash = hostClashes(brokers)
  return (brokers || []).filter((b) => !clash.has(b.id))
}

// owedLegs: the connections a reception waits for before it may be pruned
// (AGENTS.md §10). Per connection, since each keeps its own watermark: the
// row of a broker with streams has none that drains.
export function owedLegs(brokers) {
  return owedBrokers(liveBrokers(brokers).flatMap(legsOf))
}
