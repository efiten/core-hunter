import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// #617. A render-blocking stylesheet or script from another host puts that
// host in the startup path: when it does not answer, the app stops before
// first paint, on the launch screen, with nothing to retry. sw.js caches
// nothing on purpose, so there is no second source either. Everything the
// page needs to start therefore ships in the build.
//
// index.html is markup, not a module, so this reads it as text.
const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const stylesheets = [...HTML.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0])
const scripts = [...HTML.matchAll(/<script[^>]+src="[^"]*"[^>]*>/g)].map((m) => m[0])

describe('the startup path stays on our own host', () => {
  // A regex that matched nothing would make the assertions below vacuous.
  it('finds the stylesheets and scripts at all', () => {
    expect(stylesheets.length).toBeGreaterThan(0)
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('links no stylesheet from another host', () => {
    expect(stylesheets.filter((tag) => /href="(https?:)?\/\//.test(tag))).toEqual([])
  })

  it('loads no blocking script from another host', () => {
    expect(scripts.filter((tag) => /src="(https?:)?\/\//.test(tag))).toEqual([])
  })
})
