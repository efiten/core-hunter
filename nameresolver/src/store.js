import { DatabaseSync } from 'node:sqlite'

// openStore opens (or creates) the SQLite DB and returns the store interface.
// The pubkey PRIMARY KEY guarantees one row per node.
export function openStore(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS nodes (
    pubkey TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    lat    REAL,
    lon    REAL
  )`)

  const upsertStmt = db.prepare(
    `INSERT INTO nodes(pubkey, name, lat, lon) VALUES(?, ?, ?, ?)
     ON CONFLICT(pubkey) DO UPDATE SET name = excluded.name, lat = excluded.lat, lon = excluded.lon`
  )
  // pubkey is validated hex upstream; the LIKE pattern is a bound parameter.
  const resolveStmt = db.prepare(`SELECT pubkey, name, lat, lon FROM nodes WHERE pubkey LIKE ? LIMIT 2`)
  const allStmt = db.prepare(`SELECT pubkey, name, lat, lon FROM nodes`)

  return {
    upsert(rec) {
      upsertStmt.run(rec.pubkey, rec.name, rec.lat, rec.lon)
    },
    resolvePrefix(prefix) {
      return resolveStmt.all(prefix + '%')
    },
    loadCache() {
      const m = new Map()
      for (const r of allStmt.all()) m.set(r.pubkey, { name: r.name, lat: r.lat, lon: r.lon })
      return m
    },
    close() {
      db.close()
    },
  }
}
