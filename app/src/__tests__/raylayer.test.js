import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseColor, rayBuffers, canDrawRays, createRayLayer, FLOATS_PER_VERTEX, VERTS_PER_RAY, INDICES_PER_RAY } from '../raylayer.js'

// #603: in 3D a ray leaves the mast, so it cannot be a MapLibre line layer
// (those lie on the ground). The custom layer draws screen-space quads from
// mercator endpoints; this is the buffer it uploads, built without a GL
// context so it can be pinned here.
describe('parseColor', () => {
  it('reads a hex token and an rgb() value to 0..1 channels', () => {
    expect(parseColor('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(parseColor('#FF8000')).toEqual([1, 128 / 255, 0])
    expect(parseColor('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0])
    expect(parseColor('#f80')).toEqual([1, 136 / 255, 0])
  })
  it('falls back to white for anything else, never NaN', () => {
    expect(parseColor('')).toEqual([1, 1, 1])
    expect(parseColor(undefined)).toEqual([1, 1, 1])
    expect(parseColor('var(--x)')).toEqual([1, 1, 1])
  })
})

const toMerc = (lon, lat, alt) => ({ x: lon / 360, y: lat / 180, z: alt / 1000 })
const ray = (a, b, props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a, b] }, properties: { color: '#ff0000', op: 0.5, w: 2, alt: 30, ...props } })

describe('rayBuffers', () => {
  it('lays out four vertices and six indices per ray, hub end lifted to alt, hearing end on the ground', () => {
    const { vertices, indices, count } = rayBuffers([ray([4, 51], [4.01, 51.01])], toMerc)
    expect(count).toBe(1)
    expect(vertices.length).toBe(VERTS_PER_RAY * FLOATS_PER_VERTEX)
    expect(indices.length).toBe(INDICES_PER_RAY)
    expect(Array.from(indices)).toEqual([0, 1, 2, 2, 1, 3])
    const v = (i) => Array.from(vertices.subarray(i * FLOATS_PER_VERTEX, (i + 1) * FLOATS_PER_VERTEX))
    // Vertex 0 and 1 sit at the hub (alt 30 -> z 0.03), 2 and 3 at the hearing (z 0), each pair on opposite sides.
    const hub = toMerc(4, 51, 30), end = toMerc(4.01, 51.01, 0)
    expect(v(0).slice(0, 3)).toEqual([hub.x, hub.y, hub.z].map((n) => Math.fround(n)))
    expect(v(0).slice(3, 6)).toEqual([end.x, end.y, end.z].map((n) => Math.fround(n)))
    expect(v(0)[6]).toBe(1); expect(v(1)[6]).toBe(-1)
    expect(v(2).slice(0, 3)).toEqual([end.x, end.y, end.z].map((n) => Math.fround(n)))
    expect(v(2).slice(3, 6)).toEqual([hub.x, hub.y, hub.z].map((n) => Math.fround(n)))
    expect(v(2)[6]).toBe(1); expect(v(3)[6]).toBe(-1)
  })
  it('carries the colour premultiplied by opacity, and the width', () => {
    const { vertices } = rayBuffers([ray([4, 51], [4.01, 51.01], { color: '#0080ff', op: 0.5, w: 3 })], toMerc)
    const v = Array.from(vertices.subarray(0, FLOATS_PER_VERTEX))
    expect(v.slice(7, 11).map((n) => Math.round(n * 1000) / 1000)).toEqual([0, 0.251, 0.5, 0.5])
    expect(v[11]).toBe(3)
  })
  it('a ground elevation lifts both ends by the terrain under them', () => {
    const elevation = (lon) => (lon === 4 ? 100 : 20)
    const { vertices } = rayBuffers([ray([4, 51], [4.01, 51.01])], toMerc, { elevation })
    const v = (i) => Array.from(vertices.subarray(i * FLOATS_PER_VERTEX, (i + 1) * FLOATS_PER_VERTEX))
    expect(v(0)[2]).toBeCloseTo(0.13)   // 100 m ground + 30 m mast
    expect(v(2)[2]).toBeCloseTo(0.02)   // 20 m ground, hearing on it
  })
  it('skips a feature without two coordinates and indexes the rest contiguously', () => {
    const bad = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[4, 51]] }, properties: { color: '#fff', op: 1, w: 1, alt: 30 } }
    const { indices, count } = rayBuffers([bad, ray([4, 51], [4.01, 51.01]), ray([5, 52], [5.01, 52.01])], toMerc)
    expect(count).toBe(2)
    expect(Array.from(indices)).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7])
  })
})

// The quads are indexed with 32-bit integers. WebGL2 has them; a WebGL1
// context only through OES_element_index_uint, and without it every
// drawElements fails, frame after frame, with nothing said (#593 review).
const webgl1 = (uint) => ({ getExtension: vi.fn((name) => (uint && name === 'OES_element_index_uint' ? {} : null)) })
// A map whose canvas already holds one context: getContext answers it for its
// own type and null for the other, as a canvas does.
const mapWith = ({ webgl2 = null, webgl = null } = {}) => {
  const layers = new Map()
  return {
    layers,
    getLayer: (id) => layers.get(id),
    addLayer: vi.fn((l) => layers.set(l.id, l)),
    getCanvas: () => ({ getContext: (type) => (type === 'webgl2' ? webgl2 : type === 'webgl' ? webgl : null) }),
  }
}

describe('canDrawRays', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads an engine without the WebGL2 global as WebGL1 rather than throwing', () => {
    expect(typeof globalThis.WebGL2RenderingContext).toBe('undefined')
    expect(canDrawRays(webgl1(true))).toBe(true)
    expect(canDrawRays(webgl1(false))).toBe(false)
  })
  it('takes a WebGL2 context as it is, without asking for the extension', () => {
    class WebGL2 { getExtension() { throw new Error('WebGL2 has 32-bit indices built in') } }
    vi.stubGlobal('WebGL2RenderingContext', WebGL2)
    expect(canDrawRays(new WebGL2())).toBe(true)
  })
})

describe('mounting the ray layer', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('mounts on a WebGL1 context with 32-bit indices, asking for the extension on the map\'s own context', () => {
    const gl = webgl1(true), map = mapWith({ webgl: gl })
    const rays = createRayLayer('reach-3d')
    rays.addTo(map)
    expect(map.addLayer).toHaveBeenCalledWith(rays)
    expect(gl.getExtension).toHaveBeenCalledWith('OES_element_index_uint')
  })
  it('leaves a WebGL1 context without them unmounted, and says so once across style loads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const map = mapWith({ webgl: webgl1(false) })
    const rays = createRayLayer('reach-3d')
    rays.addTo(map); rays.addTo(map); rays.addTo(map)
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/OES_element_index_uint/)
  })
  it('mounts on a WebGL2 context, once, and again after a style load dropped it', () => {
    class WebGL2 {}
    vi.stubGlobal('WebGL2RenderingContext', WebGL2)
    const map = mapWith({ webgl2: new WebGL2() })
    const rays = createRayLayer('reach-3d')
    rays.addTo(map); rays.addTo(map)
    expect(map.addLayer).toHaveBeenCalledTimes(1)
    map.layers.clear()
    rays.addTo(map)
    expect(map.addLayer).toHaveBeenCalledTimes(2)
  })
})

// A GL context that keeps the state a draw can leave behind and answers
// isEnabled and getParameter from it. Everything else the layer calls is a
// no-op; drawElements records the state it was drawn with.
function stateGl() {
  const C = {
    BLEND: 0x0be2, DEPTH_TEST: 0x0b71, DEPTH_FUNC: 0x0b74, DEPTH_WRITEMASK: 0x0b72,
    BLEND_SRC_RGB: 0x80c9, BLEND_DST_RGB: 0x80c8, BLEND_SRC_ALPHA: 0x80cb, BLEND_DST_ALPHA: 0x80ca,
    ZERO: 0, ONE: 1, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, LESS: 0x0201, LEQUAL: 0x0203,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, STATIC_DRAW: 0x88e4, FLOAT: 0x1406, TRIANGLES: 4, UNSIGNED_INT: 0x1405,
  }
  const on = new Set()
  let blend = [C.ONE, C.ZERO, C.ONE, C.ZERO], depthFunc = C.LESS, depthMask = true
  const noop = () => {}
  const gl = {
    ...C, drawingBufferWidth: 800, drawingBufferHeight: 600,
    enable: (c) => on.add(c), disable: (c) => on.delete(c), isEnabled: (c) => on.has(c),
    blendFunc: (s, d) => { blend = [s, d, s, d] }, blendFuncSeparate: (...f) => { blend = f },
    depthFunc: (f) => { depthFunc = f }, depthMask: (m) => { depthMask = m },
    getParameter: (p) => ({ [C.BLEND_SRC_RGB]: blend[0], [C.BLEND_DST_RGB]: blend[1], [C.BLEND_SRC_ALPHA]: blend[2],
      [C.BLEND_DST_ALPHA]: blend[3], [C.DEPTH_FUNC]: depthFunc, [C.DEPTH_WRITEMASK]: depthMask })[p],
    createShader: () => ({}), shaderSource: noop, compileShader: noop, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader: noop, linkProgram: noop, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}), createBuffer: () => ({}), bindBuffer: noop, bufferData: noop,
    useProgram: noop, uniformMatrix4fv: noop, uniform2f: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop, disableVertexAttribArray: noop,
    state: () => ({ blend: on.has(C.BLEND), depthTest: on.has(C.DEPTH_TEST), blendFunc: [...blend], depthFunc, depthMask }),
    drawn: [],
  }
  gl.drawElements = () => gl.drawn.push(gl.state())
  return gl
}
const drawOnce = (gl) => {
  const rays = createRayLayer('reach-3d', { toMerc })
  rays.onAdd({ triggerRepaint() {} }, gl)
  rays.setData([ray([4, 51], [4.01, 51.01])])
  rays.render(gl, new Float32Array(16))
}

describe('drawing the rays', () => {
  it('blends premultiplied and tests depth without writing it while it draws', () => {
    const gl = stateGl()
    drawOnce(gl)
    expect(gl.drawn).toEqual([{ blend: true, depthTest: true, blendFunc: [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA], depthFunc: gl.LEQUAL, depthMask: false }])
  })
  // MapLibre resets what its own layers need after a custom layer, not what
  // the next custom layer starts from (#593 review).
  it('puts blending, the blend function and the depth state back as it found them', () => {
    const off = stateGl()
    off.blendFuncSeparate(off.SRC_ALPHA, off.ONE_MINUS_SRC_ALPHA, off.ONE, off.ZERO)
    const on = stateGl()
    on.enable(on.BLEND); on.enable(on.DEPTH_TEST); on.depthFunc(on.LESS); on.depthMask(false)
    for (const gl of [off, on]) {
      const before = gl.state()
      drawOnce(gl)
      expect(gl.drawn).toHaveLength(1)
      expect(gl.state()).toEqual(before)
    }
  })
})
