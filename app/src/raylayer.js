// Rays in the air (#603): the 3D twin of the coverage line layer. A MapLibre
// line layer lies on the ground, and in 3D a ray is meant to leave the mast
// 30 m up and land at the hearing. This is a custom WebGL layer that draws
// each ray as a screen-space quad between two mercator points with altitude:
// the vertex shader projects both ends, offsets the vertex sideways by the
// ray's pixel width, and the fragment shader paints the premultiplied colour.
// No library: deck.gl would do this in one layer, and would be the first
// dependency either map carries for one layer (decided 2026-09-08, a spike).
//
// rayBuffers, parseColor and canDrawRays are pure and pinned in
// raylayer.test.js, and so are when the layer mounts and the GL state a draw
// leaves behind; what the shaders paint is verified in the browser.
// Copied whole between app/src/ and web/ (parity.test.js, #238).

// Per vertex: this end (x,y,z), the other end (x,y,z), side (+1/-1), colour
// (r,g,b,a premultiplied), width in px.
export const FLOATS_PER_VERTEX = 12
export const VERTS_PER_RAY = 4
export const INDICES_PER_RAY = 6

// A --ch-hue-* token resolves to a hex or an rgb() value; both are read.
// Anything else paints white rather than NaN, which the GPU would drop.
export function parseColor(css) {
  const s = String(css ?? '').trim()
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16) / 255)
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (m) return [1, 2, 3].map((i) => Math.min(255, Number(m[i])) / 255)
  return [1, 1, 1]
}

// rayBuffers turns the coverage FeatureCollection's rays into the vertex and
// index arrays the layer uploads. toMerc(lon, lat, altM) is the map's
// MercatorCoordinate.fromLngLat; elevation(lon, lat) is the terrain height
// under a point in metres (0 without terrain), so the hub stands alt metres
// above the ground it is on and the hearing lies on its own ground.
export function rayBuffers(features, toMerc, { elevation = () => 0 } = {}) {
  const rays = (features || []).filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
  const vertices = new Float32Array(rays.length * VERTS_PER_RAY * FLOATS_PER_VERTEX)
  const indices = new Uint32Array(rays.length * INDICES_PER_RAY)
  let vi = 0, ii = 0, n = 0
  for (const f of rays) {
    const [[lon0, lat0], [lon1, lat1]] = f.geometry.coordinates
    if (![lon0, lat0, lon1, lat1].every(Number.isFinite)) continue
    const p = f.properties || {}
    const alt = Number.isFinite(p.alt) ? p.alt : 0
    const hub = toMerc(lon0, lat0, (Number(elevation(lon0, lat0)) || 0) + alt)
    const end = toMerc(lon1, lat1, Number(elevation(lon1, lat1)) || 0)
    const op = Number.isFinite(p.op) ? Math.min(1, Math.max(0, p.op)) : 1
    const [r, g, b] = parseColor(p.color)
    const w = Number.isFinite(p.w) ? p.w : 1
    const push = (a, b2, side) => {
      vertices.set([a.x, a.y, a.z, b2.x, b2.y, b2.z, side, r * op, g * op, b * op, op, w], vi)
      vi += FLOATS_PER_VERTEX
    }
    push(hub, end, 1); push(hub, end, -1); push(end, hub, 1); push(end, hub, -1)
    const base = n * VERTS_PER_RAY
    indices.set([base, base + 1, base + 2, base + 2, base + 1, base + 3], ii)
    ii += INDICES_PER_RAY
    n++
  }
  return { vertices: vertices.subarray(0, vi), indices: indices.subarray(0, ii), count: n }
}

const VERT = `
attribute vec3 a_pos;
attribute vec3 a_other;
attribute float a_side;
attribute vec4 a_color;
attribute float a_width;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
varying vec4 v_color;
void main() {
  vec4 cp = u_matrix * vec4(a_pos, 1.0);
  vec4 cq = u_matrix * vec4(a_other, 1.0);
  vec2 np = cp.xy / cp.w;
  vec2 nq = cq.xy / cq.w;
  vec2 dir = (nq - np) * u_viewport;
  float len = length(dir);
  vec2 d = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-d.y, d.x);
  // Half the width to each side, in pixels, back to clip units at this depth.
  vec2 offset = normal * a_width * 0.5 * a_side * 2.0 / u_viewport * cp.w;
  gl_Position = cp + vec4(offset, 0.0, 0.0);
  v_color = a_color;
}`
const FRAG = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`

// The quads are indexed with 32-bit integers: a busy view is tens of
// thousands of rays, four vertices each, past what 16 bits address. WebGL2
// has them; WebGL1 only through OES_element_index_uint, and asking for it is
// what turns it on for that context. Without it every drawElements fails.
// Not every engine defines the WebGL2 global, hence the typeof.
export function canDrawRays(gl) {
  if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) return true
  return !!gl.getExtension('OES_element_index_uint')
}

// createRayLayer(id, { toMerc, elevation }) returns a MapLibre custom layer
// object. addTo(map) mounts it; setData(features) rebuilds the buffers;
// setVisible(v) is what the caller flips between 2D and 3D. The layer draws
// nothing while hidden or empty, and is safe to add before any data.
export function createRayLayer(id, { toMerc, elevation } = {}) {
  let gl = null, program = null, vbo = null, ibo = null, count = 0, visible = true, pending = null
  let map = null, warned = false
  const loc = {}
  function compile(type, src) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src); gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('ray shader: ' + gl.getShaderInfoLog(sh))
    return sh
  }
  function upload(features) {
    if (!gl) { pending = features; return }
    const b = rayBuffers(features, toMerc, { elevation })
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, b.vertices, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.STATIC_DRAW)
    count = b.indices.length
    if (map) map.triggerRepaint()
  }
  const layer = {
    id, type: 'custom', renderingMode: '3d',
    // Mounts the layer unless the map's context cannot draw it (canDrawRays),
    // and then says so once rather than on every style load. The canvas
    // answers getContext with the context the map already made for that
    // type, and null for the other type, so this asks the map's own context.
    addTo(m) {
      if (m.getLayer(id)) return
      const canvas = m.getCanvas()
      if (canDrawRays(canvas.getContext('webgl2') || canvas.getContext('webgl'))) { m.addLayer(layer); return }
      if (!warned) console.warn(`${id}: this WebGL1 context has no 32-bit indices (OES_element_index_uint), so the rays are not drawn in 3D`)
      warned = true
    },
    onAdd(m, ctx) {
      map = m; gl = ctx
      const v = compile(gl.VERTEX_SHADER, VERT), f = compile(gl.FRAGMENT_SHADER, FRAG)
      program = gl.createProgram(); gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('ray program: ' + gl.getProgramInfoLog(program))
      for (const a of ['a_pos', 'a_other', 'a_side', 'a_color', 'a_width']) loc[a] = gl.getAttribLocation(program, a)
      for (const u of ['u_matrix', 'u_viewport']) loc[u] = gl.getUniformLocation(program, u)
      vbo = gl.createBuffer(); ibo = gl.createBuffer()
      if (pending) { const p = pending; pending = null; upload(p) }
    },
    onRemove() { if (gl) { gl.deleteBuffer(vbo); gl.deleteBuffer(ibo); gl.deleteProgram(program) } gl = null; map = null; count = 0 },
    render(ctx, matrix) {
      if (!visible || !count || !program) return
      const g = ctx
      // The state this draw changes, read first and put back after: MapLibre
      // resets what its own layers need, not what the next custom layer finds.
      const was = { blend: g.isEnabled(g.BLEND), depthTest: g.isEnabled(g.DEPTH_TEST),
        blendFunc: [g.BLEND_SRC_RGB, g.BLEND_DST_RGB, g.BLEND_SRC_ALPHA, g.BLEND_DST_ALPHA].map((p) => g.getParameter(p)),
        depthFunc: g.getParameter(g.DEPTH_FUNC), depthMask: g.getParameter(g.DEPTH_WRITEMASK) }
      g.useProgram(program)
      g.uniformMatrix4fv(loc.u_matrix, false, matrix)
      g.uniform2f(loc.u_viewport, g.drawingBufferWidth, g.drawingBufferHeight)
      g.bindBuffer(g.ARRAY_BUFFER, vbo)
      const S = FLOATS_PER_VERTEX * 4
      const attr = (name, size, offset) => { g.enableVertexAttribArray(loc[name]); g.vertexAttribPointer(loc[name], size, g.FLOAT, false, S, offset * 4) }
      attr('a_pos', 3, 0); attr('a_other', 3, 3); attr('a_side', 1, 6); attr('a_color', 4, 7); attr('a_width', 1, 11)
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo)
      g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
      // Behind a bar or a building the ray is hidden, but it writes no depth
      // of its own: two rays crossing must both paint.
      g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL); g.depthMask(false)
      g.drawElements(g.TRIANGLES, count, g.UNSIGNED_INT, 0)
      for (const a of ['a_pos', 'a_other', 'a_side', 'a_color', 'a_width']) g.disableVertexAttribArray(loc[a])
      g.depthMask(was.depthMask); g.depthFunc(was.depthFunc)
      g.blendFuncSeparate(...was.blendFunc)
      if (!was.depthTest) g.disable(g.DEPTH_TEST)
      if (!was.blend) g.disable(g.BLEND)
    },
    setData(features) { upload(features || []) },
    setVisible(v) { visible = !!v; if (map) map.triggerRepaint() },
    isVisible() { return visible },
    rayCount() { return count / INDICES_PER_RAY },
  }
  return layer
}
