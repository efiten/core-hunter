// The release notes both surfaces show, built from one file per entry (#509).
//
// `changelog.d/` is the source. A PR adds one file there and touches neither
// shipped copy, so two release notes can never write the same line — which is
// the whole point: before this, every merge sent every open PR back to resolve
// `changelog.json` by hand, and a union merge driver was measured to produce
// invalid JSON on 3 of 13 real merges (#518).
//
// The two copies stay committed because neither deploy can generate them: the
// app image builds with `app/` as its Docker context, and the website is copied
// to the nginx box as a flat file list. So CI regenerates them on master
// instead, and this module is what it runs.
//
// ## The filename carries the order
//
// `<date>-<NN>-<slug>.json`. NN is the entry's position within its own date,
// 01 at the top. That is load-bearing, not decoration. "Newest first" is a
// claim about dates, and a release lands several notes on one day (twelve on
// 2026-08-25), where which one goes on top is the author's choice. Sorting by
// id would hand that to the alphabet, and it would reshuffle what readers have
// already seen: the seen-state is a position in this list (`changelog.js`,
// `hasUnseenEntries`), so a moved entry re-badges every reader.
//
// The id inside the file is untouched by all of this. It stays `<date>-<slug>`,
// exactly as it shipped, for the same reason.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

// <date>-<NN>-<slug>.json. The slug is lowercase because every existing id is,
// and a name that differs from its id only in case would read as two entries.
export const ENTRY_NAME = /^(\d{4}-\d{2}-\d{2})-(\d{2})-([a-z0-9-]+)\.json$/

export const WHERE_VALUES = ['app', 'map', 'both']

// readEntryFiles reads the source directory into { name, date, ordinal, entry }
// records, in the order they must ship: newest date first, and within a date by
// the ordinal its filename carries. A file whose name does not parse stops the
// build rather than being skipped — a skipped entry is a release note that
// silently never reaches anyone.
export function readEntryFiles(dirUrl) {
  const names = readdirSync(dirUrl).filter((n) => n.endsWith('.json')).sort()
  const files = names.map((name) => {
    const m = ENTRY_NAME.exec(name)
    if (!m) throw new Error(`changelog.d/${name}: expected <date>-<NN>-<slug>.json`)
    const raw = readFileSync(new URL(name, dirUrl), 'utf8')
    let entry
    try {
      entry = JSON.parse(raw)
    } catch (e) {
      throw new Error(`changelog.d/${name}: not valid JSON (${e.message})`)
    }
    return { name, date: m[1], ordinal: Number(m[2]), entry }
  })
  return files.sort((a, b) => (a.date === b.date ? a.ordinal - b.ordinal : (a.date < b.date ? 1 : -1)))
}

// buildChangelog validates the set and returns the array the surfaces ship.
// Every rule here is one `web/parity.test.js` already asserts on the shipped
// file; checking them at the source means a bad entry fails the build that
// wrote it, rather than the suite of whoever merges next.
export function buildChangelog(files) {
  const entries = []
  const seen = new Set()
  for (const { name, date, entry } of files) {
    const at = (msg) => `changelog.d/${name}: ${msg}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(at('expected one entry object'))
    const { id, date: entryDate, where, title, body } = entry
    if (typeof id !== 'string' || !id) throw new Error(at('missing id'))
    if (seen.has(id)) throw new Error(at(`duplicate id ${id}`))
    seen.add(id)
    if (entryDate !== date) throw new Error(at(`date ${entryDate} does not match the filename's ${date}`))
    // The id's own prefix is its date: what makes "the dates do not increase
    // down the file" a statement about the ids a reader's seen-state points at.
    if (id.slice(0, 10) !== date) throw new Error(at(`id must start with ${date}`))
    if (!WHERE_VALUES.includes(where)) throw new Error(at(`where must be one of ${WHERE_VALUES.join(', ')}`))
    if (typeof title !== 'string' || !title.trim()) throw new Error(at('missing title'))
    if (typeof body !== 'string' || !body.trim()) throw new Error(at('missing body'))
    // Key order is fixed rather than inherited from the file, so a hand-written
    // entry with its keys in another order still produces a byte-identical copy.
    entries.push({ id, date: entryDate, where, title, body })
  }
  return entries
}

// serialize is the exact shape both copies ship: two-space JSON with a trailing
// newline, which is what the files carried before the split.
export function serialize(entries) {
  return JSON.stringify(entries, null, 2) + '\n'
}

// The two destinations, relative to the repo root.
export const TARGETS = ['app/changelog.json', 'web/changelog.json']

export function generate(rootUrl) {
  return serialize(buildChangelog(readEntryFiles(new URL('changelog.d/', rootUrl))))
}

// CLI: `node scripts/build-changelog.mjs` writes both copies,
// `--check` only reports whether they are already what the source produces.
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../', import.meta.url)
  const out = generate(root)
  const check = process.argv.includes('--check')
  let stale = 0
  for (const target of TARGETS) {
    const url = new URL(target, root)
    const current = (() => { try { return readFileSync(url, 'utf8') } catch { return null } })()
    if (current === out) continue
    stale++
    if (check) console.error(`${target} is not what changelog.d/ produces`)
    else { writeFileSync(url, out); console.log(`wrote ${target}`) }
  }
  if (check && stale) process.exit(1)
  if (check) console.log(`${TARGETS.length} copies up to date`)
}
