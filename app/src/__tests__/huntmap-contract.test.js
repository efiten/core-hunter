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
    const decided = Object.keys(withNoise(layerVisibility({ mode: 'auto', mode3D: true }), true)).filter((id) => id !== 'hex-labels')
    expect([...applied].sort()).toEqual([...decided].sort())
  })
})

// The 1 Hz tick hands every collection to MapLibre, and MapLibre tiles and
// uploads whatever it is handed, changed or not: 93 ms for 4501 rays and 60 ms
// for as many dots on a laptop, once a second. The collections below come out
// of a cache or a comparison, so an unchanged one is the same object, and
// put() leaves it where it is (lastSent, rendercache.js). That only holds while
// nothing writes those sources around it, and a direct setData reads like the
// lines next to it, so the next edit to draw() is where it would come back.
describe('the collections a tick can leave unchanged go to the map through put()', () => {
  const guarded = ['noise', 'points', 'points-3d', 'reach']

  it('finds put() and its guard at all', () => {
    expect(mapSrc).toMatch(/const put = \(id, data\) => \{ if \(sent\.isNew\(id, data\)\) map\.getSource\(id\)\.setData\(data\) \}/)
  })

  it.each(guarded)('%s is never written directly', (id) => {
    expect(mapSrc).not.toContain(`getSource('${id}').setData(`)
    expect(mapSrc).toContain(`put('${id}',`)
  })

  // The two hex layers (#634) are written in one loop over their slots.
  it('writes both hex layers through put()', () => {
    const cells = mapSrc.slice(mapSrc.indexOf('function drawCells'), mapSrc.indexOf('function applyFades'))
    expect(cells).toContain("for (const [id, res] of [['hex', slots.a], ['hex-b', slots.b]])")
    expect(cells).toContain('put(id, ')
    expect(cells).not.toContain('.setData(')
    expect(mapSrc).not.toContain("getSource('hex-b').setData(")
  })

  it('forgets what it sent when the overlays are mounted again, since the sources come back empty', () => {
    const mount = mapSrc.slice(mapSrc.indexOf('function addOverlays'), mapSrc.indexOf('function applyBasemap'))
    expect(mount.length).toBeGreaterThan(0)
    expect(mount).toContain('sent.clear()')
  })
})
