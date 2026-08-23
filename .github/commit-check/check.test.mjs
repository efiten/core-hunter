import { test } from 'node:test'
import assert from 'node:assert/strict'
import { squashMessage, checkMessage } from './check.mjs'

// The real defect, reduced. #434's body carried this line verbatim.
const CALLBACK = 'state.transport.onStatus((s) => {'

test('accepts the messages this repo actually produces', () => {
  for (const m of [
    'fix(app): x',
    'fix(app): x\n\nA plain paragraph.',
    'feat(app,server): x\n\n* a bullet\n* another\n\nCloses #418',
    // A fenced JS block is fine — it is the identifier(( shape that is not,
    // and the error message says so, so this case has to stay passing or the
    // advice is wrong.
    'fix(web): x\n\n```js\nif (!on) { state.connected = false }\nconst on = s === \'connected\'\nfoo(bar)\n(s) => {\n```',
  ]) assert.equal(checkMessage(m).ok, true, m.slice(0, 40))
})

test('rejects the shape release-please drops', () => {
  const r = checkMessage(`fix(app): x\n\n${CALLBACK}`)
  assert.equal(r.ok, false)
  assert.equal(r.line, 3)
  assert.equal(r.text, CALLBACK)
  assert.match(r.reason, /unexpected token/)
})

test('names the first offending line, not the last', () => {
  // Two bad lines: the report must point at the one a reader should fix first,
  // and the prefix walk is what makes that true.
  const r = checkMessage(`fix(app): x\n\nfine\n${CALLBACK}\nalso fine\nb((c`)
  assert.equal(r.line, 4)
  assert.equal(r.text, CALLBACK)
})

test('only a call at the START of a line fails', () => {
  // The advice this check prints is "indent the line by one space", so the
  // boundary it rests on is pinned here. If indenting ever stops being a fix,
  // the error message is sending people down a dead end and this fails first.
  assert.equal(checkMessage(`fix(app): x\n\n${CALLBACK}`).ok, false)
  assert.equal(checkMessage(`fix(app): x\n\n ${CALLBACK}`).ok, true, 'one space is enough')
  assert.equal(checkMessage(`fix(app): x\n\n\t${CALLBACK}`).ok, true, 'a tab is enough')
  assert.equal(checkMessage(`fix(app): x\n\ncall ${CALLBACK}`).ok, true, 'a word in front is enough')
  // ...and it is the identifier, not the parens: these never had a problem.
  assert.equal(checkMessage('fix(app): x\n\n(s) => {').ok, true)
  assert.equal(checkMessage('fix(app): x\n\n((s)').ok, true)
})

test('a fence does not protect the line inside it', () => {
  // The reason a check is needed at all: the offending line arrives inside a
  // js code fence, where it looks quoted and inert. It is not.
  const F = '```'
  assert.equal(checkMessage(`fix(app): x

${F}js
${CALLBACK}
${F}`).ok, false)
  assert.equal(checkMessage(`fix(app): x

${F}js
  ${CALLBACK}
${F}`).ok, true)
})

test('builds the squash message GitHub will build', () => {
  assert.equal(
    squashMessage({ title: 'fix(app): x', body: 'why', number: 455 }),
    'fix(app): x (#455)\n\nwhy',
  )
  // No body: subject only, with no trailing blank lines to parse.
  assert.equal(squashMessage({ title: 'fix(app): x', number: 3 }), 'fix(app): x (#3)')
  assert.equal(squashMessage({ title: 'fix(app): x', body: '   \n\n', number: 3 }), 'fix(app): x (#3)')
  // CRLF from the GitHub API must not reach the parser as \r.
  assert.equal(
    squashMessage({ title: 'fix(app): x', body: 'a\r\nb', number: 3 }),
    'fix(app): x (#3)\n\na\nb',
  )
})

test('a message with no body still reports a line', () => {
  // The walk must terminate even when the header itself is what fails.
  const r = checkMessage('not a conventional header at all')
  assert.equal(r.ok, false)
  assert.equal(r.line, 1)
})
