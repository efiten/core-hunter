import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Queue } from '../queue.js'

// app.js is excluded from unit testing by AGENTS.md §5 — it is DOM- and
// hardware-bound glue. But it still holds the drain loop, and a rename in
// queue.js that app.js doesn't follow produces a call to an undefined method
// that both drain call sites swallow in `catch (_) {}`. The app then captures
// nothing and publishes nothing, silently, with a green test suite.
//
// That is exactly how #230 shipped a build whose every drain threw
// `state.queue.takeAll is not a function`.
//
// This asserts only the seam — which methods app.js calls on the queue — so it
// stays honest as app.js evolves without pulling any DOM into the suite.
const appSrc = readFileSync(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8')
const calledMethods = [...new Set([...appSrc.matchAll(/state\.queue\.([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))]

describe('Queue satisfies the interface app.js calls (#230)', () => {
  it('finds the call sites at all, so a regex drift fails loudly instead of vacuously passing', () => {
    expect(calledMethods.length).toBeGreaterThan(0)
    expect(calledMethods).toContain('add')
  })

  it.each(calledMethods)('Queue implements %s()', (name) => {
    expect(typeof Queue.prototype[name]).toBe('function')
  })
})
