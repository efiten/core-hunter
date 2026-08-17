// Minimal static file server for the Playwright suite — serves the web/ dir.
// No dependencies; Playwright launches it via the webServer config.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, join, normalize } from 'node:path'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT) || 5179
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown', // CHANGELOG.md — read by the "what's new" panel (#284)
}

createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  const file = join(ROOT, normalize(p).replace(/^([/\\])+/, ''))
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return }
  try {
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}).listen(PORT, () => console.log(`[test-server] http://localhost:${PORT}`))
