import { describe, it, expect, vi } from 'vitest'
import { barSignature, startBarWatch, onBarChange, _resetForTests } from './barwatch.js'

// #405: one watcher on #bar. Fakes stand in for ResizeObserver,
// MutationObserver, requestAnimationFrame and the window, so the suite pins
// what the watcher decides (coalesce, compare, notify) and not what the
// browser does.
function fakes() {
  const cbs = { resize: null, mutation: null }
  const frames = []
  class Resize { constructor(cb) { cbs.resize = cb } observe() {} disconnect() { cbs.resize = null } }
  class Mutation { constructor(cb) { cbs.mutation = cb } observe() {} disconnect() { cbs.mutation = null } }
  const raf = (cb) => { frames.push(cb); return frames.length }
  const flush = () => { const f = frames.splice(0); for (const cb of f) cb() }
  const onResize = new Set()
  const win = { innerWidth: 800, innerHeight: 915,
    addEventListener(type, cb) { if (type === 'resize') onResize.add(cb) },
    removeEventListener(type, cb) { if (type === 'resize') onResize.delete(cb) } }
  const resizeWindow = (w, h) => { win.innerWidth = w; win.innerHeight = h; for (const cb of onResize) cb() }
  return { cbs, Resize, Mutation, raf, flush, win, resizeWindow }
}
const barOf = (children, w = 800, h = 48) => ({ offsetWidth: w, offsetHeight: h,
  children: children.map((c) => ({ offsetLeft: c[0], offsetTop: c[1], offsetWidth: c[2] ?? 80, offsetHeight: c[3] ?? 30 })) })
const VIEW = { innerWidth: 800, innerHeight: 915 }

describe('barSignature', () => {
  it('changes when the bar or a control moves or resizes, or the window does, and not otherwise', () => {
    const a = barSignature(barOf([[0, 0], [90, 0]]), VIEW)
    expect(barSignature(barOf([[0, 0], [90, 0]]), VIEW)).toBe(a)
    expect(barSignature(barOf([[0, 0], [0, 34]]), VIEW)).not.toBe(a)       // rewrapped at the same bar height
    expect(barSignature(barOf([[0, 0], [90, 0]], 800, 82), VIEW)).not.toBe(a) // taller
    expect(barSignature(barOf([[0, 0], [90, 0, 120]]), VIEW)).not.toBe(a)   // a control grew
    expect(barSignature(barOf([[0, 0], [90, 0]]), { ...VIEW, innerHeight: 520 })).not.toBe(a) // the window got shorter, the bar did not
  })
})

describe('startBarWatch', () => {
  it('notifies once per frame for a resize and a mutation together, and only when the geometry changed', () => {
    _resetForTests()
    const f = fakes()
    const bar = barOf([[0, 0], [90, 0]])
    startBarWatch(bar, { Resize: f.Resize, Mutation: f.Mutation, raf: f.raf, win: f.win })
    const seen = vi.fn()
    onBarChange(seen)
    // A class toggle somewhere in the bar: a mutation, no movement.
    f.cbs.mutation(); f.flush()
    expect(seen).not.toHaveBeenCalled()
    // Late content wraps a control onto a second row: resize and mutation in the same frame.
    bar.children[1].offsetLeft = 0; bar.children[1].offsetTop = 34; bar.offsetHeight = 82
    f.cbs.resize(); f.cbs.mutation(); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
    // Nothing since: another frame notifies nobody.
    f.cbs.mutation(); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
  })
  it('stops calling a listener that unsubscribed', () => {
    _resetForTests()
    const f = fakes()
    const bar = barOf([[0, 0]])
    startBarWatch(bar, { Resize: f.Resize, Mutation: f.Mutation, raf: f.raf, win: f.win })
    const seen = vi.fn()
    const off = onBarChange(seen)
    bar.offsetHeight = 60; f.cbs.resize(); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    bar.offsetHeight = 90; f.cbs.resize(); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
  })
  it('notifies when the window changes size and the bar does not', () => {
    _resetForTests()
    const f = fakes()
    const bar = barOf([[0, 0], [90, 0]])
    startBarWatch(bar, { Resize: f.Resize, Mutation: f.Mutation, raf: f.raf, win: f.win })
    const seen = vi.fn()
    onBarChange(seen)
    // A phone's window gets shorter: the bar keeps its size and its rows, so
    // neither observer fires, but an open panel is placed against the
    // viewport and has to be placed again.
    f.resizeWindow(800, 520); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
    // A resize event that changed nothing notifies nobody.
    f.resizeWindow(800, 520); f.flush()
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
