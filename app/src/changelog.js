// "What's new" reader (#284). Pure parsing of the release-please CHANGELOG.md
// both app/ and web/ already ship, plus the two decisions the badge needs. The
// rendering and the localStorage read/write live in the caller.
//
// Duplicated as app/src/changelog.js and web/changelog.js — the two deploy
// paths cannot share a file (see web/parity.test.js), which also pins the
// copies together. Keep them byte-identical.
//
// Version comparison is deliberately absent. The changelog is written newest
// first and contains every release, so "what has appeared since the version you
// acknowledged" is a position in that list, not a semver compare. That also
// makes a rollback a non-event: an older running build sits *below* the
// acknowledged version, so nothing is reported as new.

const HEADER = /^##\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))\s*(?:\(([^)]+)\))?\s*$/
const SECTION = /^###\s+(.+?)\s*$/
const BULLET = /^\*\s+(.+?)\s*$/
const COMMIT_LINK = /\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g
const LINK = /\[([^\]]*)\]\([^)]*\)/g
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }

// A bullet as release-please writes it:
//   * **app,web:** carry … ([#343](…/issues/343)) ([e924935](…/commit/e924935…))
// becomes plain text for a textContent render: the commit hash is dropped (it
// is the longest thing on the line and means nothing to a user), links collapse
// to their text so the issue number survives, bold scope markers go, and the
// entities release-please escapes into titles are decoded.
function plainText(s) {
  let out = s.replace(COMMIT_LINK, '').replace(LINK, '$1').replace(/\*\*/g, '')
  // &amp; last, so "&amp;lt;" does not decode into a "<".
  for (const [entity, ch] of Object.entries(ENTITIES)) out = out.split(entity).join(ch)
  return out.replace(/\s+/g, ' ').trim()
}

// parseChangelog turns a release-please CHANGELOG.md into
//   [{ version, date, sections: [{ title, items: [string] }] }]
// newest first, in file order. A release header with no bullets under it is
// dropped rather than rendered as an empty heading.
export function parseChangelog(md) {
  const releases = []
  let release = null
  let section = null
  for (const line of String(md || '').split('\n')) {
    const header = HEADER.exec(line)
    if (header) {
      release = { version: header[1] || header[2], date: header[3] || '', sections: [] }
      section = null
      releases.push(release)
      continue
    }
    if (!release) continue
    const sec = SECTION.exec(line)
    if (sec) {
      section = { title: sec[1], items: [] }
      release.sections.push(section)
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet && section) section.items.push(plainText(bullet[1]))
  }
  return releases.filter((r) => r.sections.some((s) => s.items.length))
}

// hasUnseen drives the badge. `seen` is the version string the user last
// acknowledged, or null/'' if they never have — a first run records the running
// version silently instead of announcing releases the user was never here for.
export function hasUnseen(current, seen) {
  return Boolean(seen) && seen !== current
}

// unseenCount is how many of the parsed releases are newer than the
// acknowledged one, i.e. how many to mark as new in the panel. 0 when nothing
// was acknowledged, and 0 when the acknowledged version is not in the file at
// all (a dev build ahead of the last release) — there is no position to count
// from, and guessing one would mark every release new.
export function unseenCount(releases, seen) {
  if (!seen) return 0
  const i = releases.findIndex((r) => r.version === seen)
  return i < 0 ? 0 : i
}
