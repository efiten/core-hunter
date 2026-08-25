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
// they have reached the broker. "All receptions go to MQTT" outranks the age
// cap, so a row that has not been published is never dropped no matter how old
// it is: a phone offline for a month keeps everything until it drains. prune()
// enforces that against the watermark.
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

// How many consecutive drain passes may fail on the SAME reception before the
// drain steps over it.
//
// Five is roughly half a minute at the 5 s tick, long enough that an ordinary
// reconnect resolves itself well inside it.
export const DRAIN_STALL_LIMIT = 5;

// nextWatermark is watermarkAfter plus a way out of a stall.
//
// The watermark only advances over an unbroken run of successes, which is
// correct and was also a trap: a reception that fails every time blocks
// everything behind it forever. On 2026-08-24 that cost a hunt -- one row was
// republished 303 times over 44 minutes on a flaky link, and every reception
// captured behind it reached the map between 71 minutes and 2 hours late. The
// median lag that night was 97 minutes, so the live map was useless for the
// whole session.
//
// The cause is that a lost PUBACK and a lost PUBLISH look identical from here.
// Blocking assumes the message never arrived; stepping over assumes it did.
// That choice used to be one-sided, because stepping over a message the broker
// never got loses a reception permanently. It is not one-sided any more: the
// ingestor stores receptions idempotently now (QoS 1 is at-least-once, so it
// always should have), which makes a duplicate free -- and that leaves one
// possible lost reception against every reception behind it.
//
// `stall` is carried by the caller across passes: { id, count }.
export function nextWatermark(watermark, outcomes, stall) {
  const prev = stall || { id: null, count: 0 };
  let last = watermark;
  let blockedAt = null;
  for (const o of outcomes || []) {
    if (!o.ok) { blockedAt = o.id; break; }
    if (o.id > last) last = o.id;
  }
  // A pass that got through clears the count rather than decaying it: the run
  // of failures this is counting has to be CONSECUTIVE, or a link that fails
  // one message in three would eventually step over a message it never sent.
  if (blockedAt === null) return { watermark: last, stall: { id: null, count: 0 }, steppedOver: null };
  const count = prev.id === blockedAt ? prev.count + 1 : 1;
  if (count >= DRAIN_STALL_LIMIT && blockedAt > last) {
    return { watermark: blockedAt, stall: { id: null, count: 0 }, steppedOver: blockedAt };
  }
  return { watermark: last, stall: { id: blockedAt, count }, steppedOver: null };
}

// watermarkAfter decides how far the watermark may move after a drain pass.
//
// The watermark means "everything at or below this id has reached the broker",
// so it may only advance over an UNBROKEN run of successes — skipping past a
// failed publish would mark that reception as sent and drop it permanently.
// `outcomes` is [{ id, ok }] in publish order. Never moves backwards, so a
// stale batch cannot propose a lower value.
export function watermarkAfter(watermark, outcomes) {
  let last = watermark;
  for (const o of outcomes || []) {
    if (!o.ok) break;
    if (o.id > last) last = o.id;
  }
  return last;
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
    // An older tab still holding a v1 connection blocks this tab's v2 upgrade.
    // Without this the promise never settles and every await on it — including
    // the add() on the capture path — hangs, silently dropping receptions.
    // Rejecting routes it into the callers' existing retry-next-cycle handling.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    req.onsuccess = () => {
      const db = req.result;
      // Symmetrically: close on demand so this tab is not the one blocking a
      // newer tab's upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
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
  // `watermark` — an unpublished row outranks the age cap. Returns how many
  // rows were removed.
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
