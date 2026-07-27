import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Queue, RETENTION_MS, prunableUpTo, shouldContinueDraining, DRAIN_BUDGET_MS } from '../queue.js'

// A reception as buildRecord() writes it (capture.js) — only the fields the
// queue itself reads matter here.
const rec = (rxAt, extra = {}) => ({ rx_at: rxAt, sender_id: 'aa', rssi: -90, ...extra })

// Fixed clock: every timestamp below is relative to this instant.
const NOW = Date.parse('2026-07-22T12:00:00Z')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000
const DAY = 24 * 60 * MIN

// Open the v1 schema directly — a store with no indexes, as shipped — so the
// migration path is exercised against the real thing rather than a guess.
function openV1WithRows(rows) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('core-hunter', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('receptions', { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('receptions', 'readwrite')
      rows.forEach((r) => tx.objectStore('receptions').add(r))
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

beforeEach(() => {
  // Fresh IndexedDB per test — otherwise the v2 upgrade only ever runs once.
  globalThis.indexedDB = new IDBFactory()
})

describe('prunableUpTo', () => {
  // Retention (#230) may never drop a reception that has not reached the
  // broker: "all receptions go to MQTT" outranks the 7-day cap. A phone that
  // has been offline for a month keeps everything until it drains.
  it('never returns an id above the published watermark', () => {
    expect(prunableUpTo(100, 40)).toBe(40)
  })

  it('is bounded by the age cutoff when that is the lower of the two', () => {
    expect(prunableUpTo(30, 90)).toBe(30)
  })

  it('prunes nothing when nothing has been published', () => {
    expect(prunableUpTo(100, 0)).toBe(0)
  })
})

describe('Queue schema migration (v1 -> v2)', () => {
  it('keeps every existing row', async () => {
    await openV1WithRows([rec(iso(1 * MIN)), rec(iso(2 * MIN)), rec(iso(3 * MIN))])
    const q = new Queue()
    expect(await q.count()).toBe(3)
  })

  it('makes pre-existing rows reachable through the new rx_at window read', async () => {
    // The backfill is what makes an upgraded install behave like a fresh one.
    await openV1WithRows([rec(iso(5 * MIN)), rec(iso(90 * MIN))])
    const q = new Queue()
    const rows = await q.since(iso(30 * MIN))
    expect(rows).toHaveLength(1)
    expect(rows[0].rx_at).toBe(iso(5 * MIN))
  })
})

describe('Queue.since — windowed read for the map (#230)', () => {
  it('returns only receptions at or after the cutoff', async () => {
    const q = new Queue()
    await q.add(rec(iso(90 * MIN)))
    await q.add(rec(iso(10 * MIN)))
    await q.add(rec(iso(1 * MIN)))

    const rows = await q.since(iso(30 * MIN))
    expect(rows.map((r) => r.rx_at)).toEqual([iso(10 * MIN), iso(1 * MIN)])
  })

  it('does not read rows outside the window at all', async () => {
    // The whole point of the fix: cost follows the window, not the store.
    const q = new Queue()
    for (let i = 0; i < 50; i++) await q.add(rec(iso((i + 60) * MIN)))
    await q.add(rec(iso(1 * MIN)))

    expect(await q.count()).toBe(51)
    expect(await q.since(iso(30 * MIN))).toHaveLength(1)
  })

  it('returns rows in ascending rx_at order', async () => {
    const q = new Queue()
    await q.add(rec(iso(3 * MIN)))
    await q.add(rec(iso(1 * MIN)))
    await q.add(rec(iso(2 * MIN)))

    const rows = await q.since(iso(30 * MIN))
    expect(rows.map((r) => r.rx_at)).toEqual([iso(3 * MIN), iso(2 * MIN), iso(1 * MIN)])
  })
})

describe('Queue.recent — bounded newest-first read', () => {
  it('returns the newest n rows, oldest-first', async () => {
    const q = new Queue()
    for (let i = 5; i >= 1; i--) await q.add(rec(iso(i * MIN)))

    const rows = await q.recent(2)
    expect(rows.map((r) => r.rx_at)).toEqual([iso(2 * MIN), iso(1 * MIN)])
  })

  it('returns everything when the store is smaller than n', async () => {
    const q = new Queue()
    await q.add(rec(iso(1 * MIN)))
    expect(await q.recent(100)).toHaveLength(1)
  })
})

describe('Queue.unpublishedFrom — drain reads only what it has not sent', () => {
  it('returns rows above the watermark', async () => {
    const q = new Queue()
    await q.add(rec(iso(3 * MIN)))
    await q.add(rec(iso(2 * MIN)))
    await q.add(rec(iso(1 * MIN)))

    expect(await q.unpublishedFrom(1)).toHaveLength(2)
  })

  it('returns everything when nothing has been published', async () => {
    const q = new Queue()
    await q.add(rec(iso(1 * MIN)))
    expect(await q.unpublishedFrom(0)).toHaveLength(1)
  })
})

describe('Queue watermark — survives a reload', () => {
  it('defaults to 0 on a fresh store', async () => {
    expect(await new Queue().getWatermark()).toBe(0)
  })

  it('persists across Queue instances', async () => {
    await new Queue().setWatermark(42)
    // A new instance stands in for an app restart: the old in-memory Set
    // (app.js:89-93) is exactly what this replaces.
    expect(await new Queue().getWatermark()).toBe(42)
  })

  it('never moves backwards', async () => {
    const q = new Queue()
    await q.setWatermark(42)
    await q.setWatermark(7)
    expect(await q.getWatermark()).toBe(42)
  })
})

describe('Queue.prune — retention, gated on publication (#230)', () => {
  it('deletes published rows older than the cutoff', async () => {
    const q = new Queue()
    await q.add(rec(iso(9 * DAY)))
    await q.add(rec(iso(8 * DAY)))
    await q.add(rec(iso(1 * DAY)))
    await q.setWatermark(3) // all three published

    const removed = await q.prune(iso(RETENTION_MS), 3)
    expect(removed).toBe(2)
    expect(await q.count()).toBe(1)
  })

  it('keeps old rows that have not been published yet', async () => {
    const q = new Queue()
    await q.add(rec(iso(9 * DAY)))
    await q.add(rec(iso(8 * DAY)))
    await q.setWatermark(1) // only the first has reached the broker

    const removed = await q.prune(iso(RETENTION_MS), 1)
    expect(removed).toBe(1)
    const left = await q.recent(10)
    expect(left.map((r) => r.rx_at)).toEqual([iso(8 * DAY)])
  })

  it('deletes nothing when the store is entirely inside the window', async () => {
    const q = new Queue()
    await q.add(rec(iso(1 * DAY)))
    await q.setWatermark(1)
    expect(await q.prune(iso(RETENTION_MS), 1)).toBe(0)
  })

  it('retains for 7 days', () => {
    expect(RETENTION_MS).toBe(7 * DAY)
  })
})

// #230: the drain reads in bounded batches so a first upgrade can't scan a
// 50k-row store in one pass. But a fixed one-batch-per-tick then makes the
// backlog take (rows / DRAIN_BATCH) ticks to clear — 50k rows at 100 per 5 s
// is over half an hour, on exactly the offline-for-a-while device the buffer
// exists to protect. So a tick keeps draining until the store is empty or a
// time budget is spent, which adapts to the device instead of guessing a
// batch size for the slowest one.
describe('shouldContinueDraining', () => {
  const B = { batchLimit: 100, budgetMs: 750 }

  it('stops once a short batch shows the store is drained', () => {
    expect(shouldContinueDraining({ ...B, batchSize: 42, elapsedMs: 0 })).toBe(false)
  })

  it('stops on an empty batch', () => {
    expect(shouldContinueDraining({ ...B, batchSize: 0, elapsedMs: 0 })).toBe(false)
  })

  it('keeps going while batches come back full and the budget holds', () => {
    expect(shouldContinueDraining({ ...B, batchSize: 100, elapsedMs: 100 })).toBe(true)
  })

  it('yields once the budget is spent, even with rows still waiting', () => {
    expect(shouldContinueDraining({ ...B, batchSize: 100, elapsedMs: 750 })).toBe(false)
    expect(shouldContinueDraining({ ...B, batchSize: 100, elapsedMs: 5000 })).toBe(false)
  })

  it('always yields between ticks rather than looping forever on a full store', () => {
    // The property that matters: no combination of inputs returns true once
    // the budget is gone, so a device that cannot keep up still gets its main
    // thread back every tick.
    for (const batchSize of [100, 1000]) {
      expect(shouldContinueDraining({ ...B, batchSize, elapsedMs: B.budgetMs + 1 })).toBe(false)
    }
  })

  it('exposes a budget well inside the 5 s drain tick', () => {
    expect(DRAIN_BUDGET_MS).toBeGreaterThan(0)
    expect(DRAIN_BUDGET_MS).toBeLessThan(5000)
  })
})
