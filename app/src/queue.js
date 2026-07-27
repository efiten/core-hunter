// Offline-first capture buffer (IndexedDB). The field often has no cellular, so
// receptions are buffered locally and published when connectivity returns.
//
// Reads are bounded (#230). The store used to be read in full — getAll() —
// on both the 1 s render tick and the 5 s drain tick, so every tick cost
// O(total receptions ever captured). Past ~20k rows that saturates the main
// thread, which is what starved the renderer, missed the MQTT keepalive and
// timed out the login fetch. Every read below is scoped instead:
//
//   since()            the display window, via the rx_at index
//   recent(n)          the newest n rows, via a reverse cursor on the id
//   unpublishedFrom()  only rows the drain has not sent yet, via the watermark
//
// The watermark replaces an in-memory Set that was empty on every boot, which
// made a restart re-publish the entire store.
const DB_NAME = 'core-hunter';
const STORE = 'receptions';
const META = 'meta';
const WATERMARK_KEY = 'published_through';

// Retention (#230): receptions older than this are pruned — but only once
// they have reached the broker. See prunableUpTo().
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Drain reads in bounded batches to avoid O(store) scans on first upgrade.
export const DRAIN_BATCH = 100;

// ...but one batch per tick would then make a backlog take (rows / DRAIN_BATCH)
// ticks to clear — 50k rows at 100 per 5 s is over half an hour, on exactly the
// been-offline-a-while device the buffer exists to protect. So a tick keeps
// draining until the store is empty or this budget is spent. A time budget
// rather than a bigger batch: it adapts to whatever the device and the link can
// actually manage, instead of guessing a number that is too slow on a fast
// phone and still too much work on a slow one.
export const DRAIN_BUDGET_MS = 750;

// shouldContinueDraining decides whether the drain loop takes another batch.
// A short batch means the store is drained (getAll returned fewer than the
// limit), so there is nothing to come back for. Otherwise keep going until the
// budget is gone — the loop always yields between ticks, so a device that
// cannot keep up still gets its main thread back.
export function shouldContinueDraining({ batchSize, batchLimit = DRAIN_BATCH, elapsedMs, budgetMs = DRAIN_BUDGET_MS }) {
  if (batchSize < batchLimit) return false;
  return elapsedMs < budgetMs;
}

// prunableUpTo picks the highest row id retention is allowed to delete through.
// "All receptions go to MQTT" outranks the age cap, so a row that has not been
// published is never dropped no matter how old it is — a phone that has been
// offline for a month keeps everything until it drains.
export function prunableUpTo(oldestAllowedId, watermark) {
  return Math.min(oldestAllowedId, watermark);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const store = e.oldVersion < 1
        ? db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        : req.transaction.objectStore(STORE);
      // Creating the index indexes the rows already in the store, so an
      // upgraded install needs no explicit backfill pass.
      if (!store.indexNames.contains('rx_at')) store.createIndex('rx_at', 'rx_at');
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Resolve on transaction completion rather than request success: the write is
// only durable once the transaction commits.
function done(tx, value) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(typeof value === 'function' ? value() : value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Queue {
  async add(record) {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    return done(tx);
  }

  // since returns the receptions at or after `cutoffIso`, ascending by rx_at —
  // the map's display window. rx_at is an ISO-8601 UTC string (capture.js), so
  // lexicographic key order is chronological order.
  async since(cutoffIso) {
    const db = await openDB();
    const idx = db.transaction(STORE, 'readonly').objectStore(STORE).index('rx_at');
    return (await result(idx.getAll(IDBKeyRange.lowerBound(cutoffIso)))) || [];
  }

  // recent returns the newest `n` rows, oldest-first. Used by the consumers
  // that are not window-scoped (the receptions log's "all" mode, the target
  // list) — bounded by row count instead of by time.
  async recent(n) {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const req = store.openCursor(null, 'prev');
    const rows = [];
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || rows.length >= n) return resolve(rows.reverse());
        rows.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // unpublishedFrom returns the rows above the watermark — everything the
  // drain still owes the broker, in id order. Limited to DRAIN_BATCH so
  // the first upgrade doesn't scan the entire store in one pass.
  async unpublishedFrom(watermark) {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    return (await result(store.getAll(IDBKeyRange.lowerBound(watermark, true), DRAIN_BATCH))) || [];
  }

  async getWatermark() {
    const db = await openDB();
    const store = db.transaction(META, 'readonly').objectStore(META);
    const row = await result(store.get(WATERMARK_KEY));
    return row ? row.v : 0;
  }

  // setWatermark is monotonic: the drain advances it to the last contiguous
  // success, and a later partial pass must never walk it back over rows that
  // were already sent.
  async setWatermark(id) {
    const current = await this.getWatermark();
    if (id <= current) return current;
    const db = await openDB();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ k: WATERMARK_KEY, v: id });
    return done(tx, id);
  }

  // prune deletes receptions older than `cutoffIso`, but never past
  // `watermark` — see prunableUpTo(). Returns how many rows were removed.
  async prune(cutoffIso, watermark) {
    if (watermark <= 0) return 0;
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('rx_at');
    const req = idx.openCursor(IDBKeyRange.upperBound(cutoffIso, true));
    let removed = 0;
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (cur.primaryKey <= watermark) { cur.delete(); removed++; }
      cur.continue();
    };
    return done(tx, () => removed);
  }

  async count() {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    return result(store.count());
  }
}
