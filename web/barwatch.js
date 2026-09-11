// One watcher on #bar (#405). The bar changes shape from two directions: the
// window resizes, and its own content grows after load (the packet chips,
// the role notice with /api/auth/me, the node counts, the server version),
// each arrival wrapping another row. Four features used to watch for that
// on their own, three of them on window.resize, which never fires for the
// second kind, so a bar that grew while a panel was open left the panel
// pointing at nothing (#386 was the same fault for the ticker).
//
// This is the one place that decides what a bar change is. A ResizeObserver
// sees the size, a MutationObserver sees content that can rewrap a row at a
// constant height (a label that widens moves the controls after it); both
// only schedule a check, and the check compares the bar's geometry with
// what it was: the bar's size and each control's box. Listeners hear from it
// once per frame, and only when something moved. That comparison is also
// what stops the loop a listener would otherwise start: placing a popover
// writes attributes inside the bar, which the MutationObserver reports, but
// a fixed-position panel is out of flow and moves no control.
//
// The window's size is part of that comparison, and its resize event is a
// third trigger. The panels are placed against the viewport, and a window
// that only changes height moves nothing in the bar: without it, an open
// time picker on a phone kept its 616px bottom edge in a 520px window. The
// event also gets a panel placed in the frame the resize lands in, as the
// window.resize listeners this replaced did; a check the ResizeObserver asks
// for runs a frame later.
//
// #map is deliberately NOT a listener. It follows the bar on window.resize
// only (map.js setMapTop): invalidateSize moves the centre by half the size
// change, so following every late arrival during load walks the neutral
// world view off its mark (#218, measured 0.14 degrees with pan on, 13
// with it off). A user-driven resize is a different case, since holding the
// visible content still across it is the wanted behaviour. What #map loses
// is a few stale pixels behind the bar, which paints above it.

const listeners = new Set()
let scheduled = false
let last = null

// The geometry as one string: the window's size, the bar's, and each in-flow
// child's box. The controls sit in those children; a panel is a fixed
// descendant and out of flow, so it is not in the signature, which is the
// point (above).
export function barSignature(bar, win) {
  const parts = [win.innerWidth, win.innerHeight, bar.offsetWidth, bar.offsetHeight]
  for (const c of bar.children) parts.push(c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight)
  return parts.join(',')
}

// onBarChange registers a listener; returns the unsubscribe.
export function onBarChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// startBarWatch attaches the two observers to the bar and a resize listener
// to the window. The constructors, requestAnimationFrame and the window are
// parameters so the unit suite can drive it.
export function startBarWatch(bar, { Resize = globalThis.ResizeObserver, Mutation = globalThis.MutationObserver, raf = (cb) => requestAnimationFrame(cb), win = globalThis } = {}) {
  last = barSignature(bar, win)
  const check = () => {
    scheduled = false
    const sig = barSignature(bar, win)
    if (sig === last) return
    last = sig
    for (const fn of listeners) fn()
  }
  const schedule = () => { if (scheduled) return; scheduled = true; raf(check) }
  const ro = Resize ? new Resize(schedule) : null
  if (ro) ro.observe(bar)
  const mo = Mutation ? new Mutation(schedule) : null
  if (mo) mo.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true })
  win.addEventListener('resize', schedule)
  return { stop() { if (ro) ro.disconnect(); if (mo) mo.disconnect(); win.removeEventListener('resize', schedule) } }
}

export function _resetForTests() { listeners.clear(); scheduled = false; last = null }
