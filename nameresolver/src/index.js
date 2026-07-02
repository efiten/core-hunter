import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig } from './config.js'
import { openStore } from './store.js'
import { startIngest } from './ingest.js'
import { createServer } from './http.js'

const cfg = loadConfig(process.argv[2] || 'config.json')

// Ensure the SQLite parent dir exists (the docker volume mount point).
if (cfg.dbPath !== ':memory:') mkdirSync(dirname(cfg.dbPath), { recursive: true })

const store = openStore(cfg.dbPath)
const cache = store.loadCache()

startIngest(cfg, { store, cache })

const server = createServer(store)
server.listen(cfg.httpPort, () => {
  console.log(`nameresolver: http on :${cfg.httpPort}, ${cache.size} names loaded from ${cfg.dbPath}`)
})
