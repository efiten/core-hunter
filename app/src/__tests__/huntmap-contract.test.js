import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHuntMap } from '../huntmap.js'

// createHuntMap returns a no-op fallback when MapLibre's script did not load
// or WebGL is unavailable, so app init never throws. app.js then calls the
// fallback exactly as it calls the real map, and app init runs as one async
// DOMContentLoaded handler: one missing method throws there and every listener
// wired after that line is never attached.
//
// This asserts only the seam, as queue-contract.test.js does for the queue:
// every method app.js calls on state.map exists on the fallback. Under node
// there is no maplibregl global, so createHuntMap returns the fallback.
const appSrc = readFileSync(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8')
const calledMethods = [...new Set([...appSrc.matchAll(/state\.map\.([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))]

describe('the no-map fallback satisfies the interface app.js calls', () => {
  it('finds the call sites at all, so a regex drift fails loudly instead of vacuously passing', () => {
    expect(calledMethods.length).toBeGreaterThan(0)
    expect(calledMethods).toContain('setPosition')
  })

  const fallback = createHuntMap('map')
  it.each(calledMethods)('the fallback implements %s()', (name) => {
    expect(typeof fallback[name]).toBe('function')
  })
})
