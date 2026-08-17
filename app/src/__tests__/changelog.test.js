import { describe, it, expect } from 'vitest'
import { parseChangelog, hasUnseen, unseenCount } from '../changelog.js'

// Verbatim shape of a release-please CHANGELOG.md (app/CHANGELOG.md, 2026-08-15):
// a link-wrapped version header, blank lines, `### <section>` per commit type,
// and one `* ` bullet per commit carrying a scope, an issue link and a commit
// link. Written out in full rather than trimmed, because every transformation
// below is about a detail that only exists in the real file.
const MD = `# Changelog

## [1.7.0](https://github.com/efiten/core-hunter/compare/app-v1.6.0...app-v1.7.0) (2026-08-15)


### Features

* **app,web:** carry the decoder's full packet-type set in the filter chips ([#343](https://github.com/efiten/core-hunter/issues/343)) ([e924935](https://github.com/efiten/core-hunter/commit/e924935728c677241dafe369ef18508223a9c339))


### Bug Fixes

* **app:** guard localStorage reads so a storage-hostile context cannot blank the app ([#342](https://github.com/efiten/core-hunter/issues/342)) ([ce9d534](https://github.com/efiten/core-hunter/commit/ce9d534acd6ad081f07b3bff0073816233a5dbef))

## [1.6.0](https://github.com/efiten/core-hunter/compare/app-v1.5.1...app-v1.6.0) (2026-08-08)


### Features

* **app:** merge layer FAB + 2D/3D FAB into one 5-state view cycle ([#314](https://github.com/efiten/core-hunter/issues/314)) ([9e48a38](https://github.com/efiten/core-hunter/commit/9e48a38d3e1611089ced882a64cba53d210eec61)), closes [#258](https://github.com/efiten/core-hunter/issues/258)


### Tests

* **web:** pin app&lt;-&gt;web parity for the duplicated modules ([#238](https://github.com/efiten/core-hunter/issues/238) option 2) ([#359](https://github.com/efiten/core-hunter/issues/359)) ([473e84e](https://github.com/efiten/core-hunter/commit/473e84e9293309bf8c2feefa42b4bb427bf990c3))

## 0.1.0 (2026-06-29)


### Features

* **app:** first cut ([7af52b7](https://github.com/efiten/core-hunter/commit/7af52b76c0635cc11a11165133bcca746576a4c2))
`

describe('parseChangelog', () => {
  const rel = parseChangelog(MD)

  it('returns one entry per ## header, newest first, with version and date', () => {
    expect(rel.map((r) => r.version)).toEqual(['1.7.0', '1.6.0', '0.1.0'])
    expect(rel.map((r) => r.date)).toEqual(['2026-08-15', '2026-08-08', '2026-06-29'])
  })

  it('reads a bare version header, not only a compare-link one', () => {
    // release-please writes the very first release without a compare link, so
    // a regex that requires `[x](url)` silently drops it.
    expect(rel[2]).toMatchObject({ version: '0.1.0', date: '2026-06-29' })
  })

  it('groups bullets under their ### section, in file order', () => {
    expect(rel[0].sections.map((s) => s.title)).toEqual(['Features', 'Bug Fixes'])
    expect(rel[1].sections.map((s) => s.title)).toEqual(['Features', 'Tests'])
    expect(rel[0].sections[1].items).toHaveLength(1)
  })

  it('drops the commit-hash link but keeps the issue reference', () => {
    // The hash is noise to a user and is the longest thing on the line; the
    // issue number is how they find the discussion.
    expect(rel[0].sections[0].items[0])
      .toBe("app,web: carry the decoder's full packet-type set in the filter chips (#343)")
  })

  it('keeps a trailing "closes" reference, without its link', () => {
    expect(rel[1].sections[0].items[0])
      .toBe('app: merge layer FAB + 2D/3D FAB into one 5-state view cycle (#314), closes #258')
  })

  it('unescapes the HTML entities release-please writes into titles', () => {
    // `app<->web` arrives as `app&lt;-&gt;web`; rendered as textContent it would
    // otherwise show the entities literally.
    expect(rel[1].sections[1].items[0]).toContain('app<->web parity')
    // Two links in one bullet: the inner (#238 …) text survives with the outer.
    expect(rel[1].sections[1].items[0]).toContain('(#238 option 2) (#359)')
  })

  it('has no leftover markdown syntax in any item', () => {
    const all = rel.flatMap((r) => r.sections.flatMap((s) => s.items))
    for (const item of all) {
      expect(item).not.toMatch(/[[\]]|\*\*|https?:\/\//)
    }
  })

  it('is empty for input with no release header', () => {
    expect(parseChangelog('# Changelog\n')).toEqual([])
    expect(parseChangelog('')).toEqual([])
  })

  it('drops a release whose header carries no bullets', () => {
    // A version header with an empty body renders as a heading with nothing
    // under it, which reads as a rendering bug rather than as a release.
    const md = '## [2.0.0](x) (2026-01-01)\n\n## [1.0.0](x) (2025-01-01)\n\n### Features\n\n* **app:** a thing\n'
    expect(parseChangelog(md).map((r) => r.version)).toEqual(['1.0.0'])
  })
})

describe('hasUnseen', () => {
  it('is false on a first run, so a new user is not told about releases they never saw', () => {
    expect(hasUnseen('1.7.0', null)).toBe(false)
    expect(hasUnseen('1.7.0', '')).toBe(false)
  })

  it('is false once the running version has been acknowledged', () => {
    expect(hasUnseen('1.7.0', '1.7.0')).toBe(false)
  })

  it('is true when the running version differs from the acknowledged one', () => {
    expect(hasUnseen('1.7.0', '1.6.0')).toBe(true)
  })
})

describe('unseenCount', () => {
  const rel = parseChangelog(MD)

  it('counts the releases published after the acknowledged one', () => {
    expect(unseenCount(rel, '1.6.0')).toBe(1)
    expect(unseenCount(rel, '0.1.0')).toBe(2)
  })

  it('is 0 when the acknowledged version is the newest one', () => {
    expect(unseenCount(rel, '1.7.0')).toBe(0)
  })

  it('is 0 when nothing was acknowledged, matching hasUnseen on a first run', () => {
    expect(unseenCount(rel, null)).toBe(0)
  })

  it('is 0 for a version not in the file, e.g. a dev build ahead of the last release', () => {
    expect(unseenCount(rel, '9.9.9')).toBe(0)
  })
})
