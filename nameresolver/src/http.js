import http from 'node:http'

const HEX = /^[0-9a-f]{2,64}$/
const MIN_PREFIX_HEX = 4

// resolvePrefixResponse implements the CoreScope-compatible resolve contract.
// Returns { status, json }. No CORS headers — corsproxy adds them.
export function resolvePrefixResponse(store, rawPrefix) {
  const pfx = String(rawPrefix || '').trim().toLowerCase()
  if (!HEX.test(pfx)) return { status: 400, json: { error: 'prefix must be hex' } }
  if (pfx.length < MIN_PREFIX_HEX) return { status: 400, json: { error: 'prefix must be at least 4 hex chars' } }

  const rows = store.resolvePrefix(pfx)
  if (rows.length === 0) return { status: 200, json: { prefix: pfx, ambiguous: false } }
  if (rows.length >= 2) return { status: 200, json: { prefix: pfx, ambiguous: true } }

  const r = rows[0]
  const json = { prefix: pfx, pubkey: r.pubkey, name: r.name, ambiguous: false }
  if (r.lat != null) json.lat = r.lat
  if (r.lon != null) json.lon = r.lon
  return { status: 200, json }
}

// createServer wires the resolve endpoint + a healthz liveness probe.
export function createServer(store) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/nodes/resolve') {
      const { status, json } = resolvePrefixResponse(store, url.searchParams.get('prefix'))
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
}
