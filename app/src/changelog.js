// Release notes for readers (#284, rewritten for #422).
//
// This used to parse the release-please CHANGELOG.md, which is a commit log, so
// the panel read like one: "app,web: keep the receptions ticker off the bar's
// last row (#388)". The scope prefix, the conventional-commit vocabulary and
// the issue number all survived the stripping, and most of what a release
// contains — chore, docs, test — is invisible to the person reading it.
//
// The source is now a hand-written changelog.json: one entry per change a user
// could notice, in plain language, newest first. CHANGELOG.md stays exactly as
// it is and stays the developer-facing record; the panel links out to it.
//
// Duplicated as app/src/changelog.js and web/changelog.js — the two deploy
// paths cannot share a file (see web/parity.test.js), which also pins the
// copies together. Keep them byte-identical.
//
// Seen-state is the newest entry's id rather than a version string. A release
// with nothing user-visible in it therefore raises no dot, which is the whole
// point: the old scheme badged every release, including the ones that only
// moved code around.

// Where an entry applies. The surfaces a reader recognises, not the repo's
// directory names: `map` is the shared coverage map on the web, `app` is the
// hunter PWA on their phone.
const WHERE_LABELS = { app: 'App', map: 'Map', both: 'App and map' }

// whereLabel renders that field. changelog.json is written by hand, so an
// unrecognised value costs the label and nothing else — a typo must not take
// the panel down with it.
export function whereLabel(where) {
  return WHERE_LABELS[where] || ''
}

// Index of the acknowledged entry, or -1 when there is no position to count
// from: nothing acknowledged (a first run), or an id the file no longer
// contains because the entry was edited or dropped. Guessing a position in
// either case marks the whole file new.
function seenIndex(entries, seenId) {
  if (!Array.isArray(entries) || !seenId) return -1
  return entries.findIndex((e) => e && e.id === seenId)
}

// unseenEntryCount is how many entries sit above the acknowledged one, i.e.
// how many to mark as new in the panel.
export function unseenEntryCount(entries, seenId) {
  const i = seenIndex(entries, seenId)
  return i === -1 ? 0 : i
}

// hasUnseenEntries drives the dot: the newest entry is not the one this reader
// acknowledged. Deliberately not `unseenEntryCount > 0` — an acknowledged id
// that has fallen out of the file badges nothing (no position) but is also not
// "up to date", and the two answers are allowed to differ, as they did under
// the version-string scheme.
export function hasUnseenEntries(entries, seenId) {
  if (!Array.isArray(entries) || !entries.length || !seenId) return false
  return entries[0].id !== seenId
}

// migratedSeenId decides what to store at boot, and is the whole of the #422
// migration. Three readers, three answers:
//
//   - already on the new scheme  -> keep their id, nothing changes
//   - acknowledged the OLD version-string scheme -> carry that value over
//   - never acknowledged anything -> record the newest id silently, because a
//     first-time reader has no "since you were last here"
//
// Without the middle case, every existing reader would have been treated as up
// to date and would never have seen that the notes changed at all.
//
// The middle case carries the version string across rather than storing
// nothing, and that is load-bearing rather than lazy. Storing nothing is
// indistinguishable from a first visit, and hasUnseenEntries is silent for
// those by design — the dot would never appear. A version string is not an id
// in the file, so it lands in exactly the state both functions already handle:
// hasUnseenEntries sees the newest entry is not it (dot), unseenEntryCount
// finds no position (nothing marked new). Opening the panel then replaces it
// with a real id and the migration is over.
export function migratedSeenId(storedId, legacyAck, newestId) {
  if (storedId) return storedId
  if (legacyAck) return legacyAck
  return newestId
}
