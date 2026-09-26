import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHuntMap } from '../huntmap.js'
import { layerVisibility } from '../maplayers.js'
import { withNoise } from '../noise.js'

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

// The other seam in huntmap.js worth reading out of the source. layerVisibility
// decides a layer's visibility in two places -- the style load and the view FAB
// -- and #266 pulled the decision into one module precisely because those two
// had drifted. The decision being shared is not enough: applyLayerVisibility
// walks a hand-written list of ids, so a layer added to layerVisibility and
// forgotten here keeps whatever the last style load gave it. That failure is
// silent and only shows on the FAB path, which is the path a driver uses.
const mapSrc = readFileSync(fileURLToPath(new URL('../huntmap.js', import.meta.url)), 'utf8')
const applyBlock = mapSrc.slice(mapSrc.indexOf('function applyLayerVisibility'))
const idList = applyBlock.match(/for \(const id of \[([^\]]+)\]\)/)

describe('applyLayerVisibility covers every layer layerVisibility decides', () => {
  it('finds the list at all, so a rename fails loudly instead of vacuously passing', () => {
    expect(idList).not.toBeNull()
    expect(mapSrc).toContain('function applyLayerVisibility')
  })

  it('applies each one', () => {
    const applied = idList[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    // Every state is the same set of keys (maplayers.test.js pins that), so any
    // one of them names the full set. hex-labels is the single exception: it is
    // not a style layer but DOM markers, applied through drawHexLabels().
    // The noise layer (#410) is decided on top of it, by withNoise.
    const decided = Object.keys(withNoise(layerVisibility({ mode: 'both', mode3D: true }), true)).filter((id) => id !== 'hex-labels')
    expect([...applied].sort()).toEqual([...decided].sort())
  })
})
