// Fails a PR whose squash commit release-please would silently drop (#448).
//
// release-please does not use conventional-commits-parser (the lenient one that
// most tooling means by "the conventional commits parser"). It uses the strict
// spec parser, @conventional-commits/parser, and a message that parser cannot
// read is not warned about — it is dropped from the changelog entirely and does
// not count toward the version bump. #434 went out that way: it is on master
// and absent from app/CHANGELOG.md, and the only trace was one line in a
// workflow log.
//
// That was invisible because four other commits bumped the app anyway. A
// release whose only user-facing commit is unparseable produces no release at
// all, and nothing says so.
//
// The trigger is narrow, and narrower than it first looks. Only a line that
// STARTS at column 0 with an identifier immediately followed by two open
// parens fails: there the grammar is looking for a footer token, `(` opens
// what it reads as a scope, and a second `(` is invalid inside one. Indent the
// same line by a single space, or put any word in front of it, and it parses —
// the token stream is no longer a footer.
//
// #434's body had it at column 0 inside a fenced block. That is an ordinary JS
// callback, and our squash bodies are PR descriptions, which routinely contain
// JavaScript, so the shape will recur. Hence a check rather than a rule.
import { parser } from '@conventional-commits/parser'
import { pathToFileURL } from 'node:url'

// This repo squashes, and GitHub composes the squash commit as the PR title
// with `(#N)` appended, then the PR body verbatim. Verified against the merged
// commits: subject `feat(app): … (#455)`, body identical to the description.
export function squashMessage({ title = '', body = '', number = 0 } = {}) {
  const subject = number ? `${title} (#${number})` : title
  const text = String(body || '').replace(/\r\n/g, '\n').trim()
  return text ? `${subject}\n\n${text}` : subject
}

function parses(text) {
  try {
    parser(text)
    return true
  } catch (_) {
    return false
  }
}

// checkMessage answers whether release-please can read this message, and when
// it cannot, which line broke it.
//
// The line is found by parsing growing prefixes rather than by matching a
// pattern: the grammar decides what is invalid, and a regex approximating it
// would be a second, wrong answer to the same question — the guessing this
// check exists to replace. The first prefix that fails ends on the offending
// line.
export function checkMessage(message) {
  const text = String(message || '')
  if (parses(text)) return { ok: true }

  const lines = text.split('\n')
  let line = lines.length
  for (let n = 1; n <= lines.length; n++) {
    if (!parses(lines.slice(0, n).join('\n'))) { line = n; break }
  }

  let reason = ''
  try {
    parser(text)
  } catch (e) {
    reason = String((e && e.message) || e).split('\n')[0]
  }
  return { ok: false, line, text: lines[line - 1] ?? '', reason }
}

async function main() {
  const { readFile } = await import('node:fs/promises')
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) {
    console.error('No GITHUB_EVENT_PATH — this check only runs on pull_request events.')
    process.exit(1)
  }
  const event = JSON.parse(await readFile(path, 'utf8'))
  const pr = event.pull_request
  if (!pr) {
    console.log('No pull_request in the event payload; nothing to check.')
    return
  }

  const message = squashMessage({ title: pr.title, body: pr.body, number: pr.number })
  const result = checkMessage(message)
  if (result.ok) {
    console.log('Squash message parses — release-please will see this commit.')
    return
  }

  console.error('This PR\'s squash commit cannot be parsed by release-please.')
  console.error('It would be dropped from the changelog and from the version bump, silently.\n')
  console.error(`  line ${result.line}: ${result.text}`)
  console.error(`  parser: ${result.reason}\n`)
  console.error('This is almost always a line starting at column 0 with an identifier')
  console.error('followed immediately by two open parens — an ordinary JS callback.')
  console.error('Indenting that line by one space fixes it, and nothing else has to change:')
  console.error('the same line indented parses, and so does any line with a word in front')
  console.error('of it. Fenced code blocks are fine and do not need removing.')
  process.exit(1)
}

// Only run main when executed directly, so the test can import the two
// functions without the event-payload plumbing firing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
