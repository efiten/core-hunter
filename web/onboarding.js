// First-run onboarding overlay for the analysis website (#316), mirroring the
// app's splash (app/src/splash.js): a scrim over the map, the real toolbar
// controls lifted through it and ringed, a callout beside each group, and a
// centre panel with the tagline, the getting-started basics and the position
// disclaimer. Re-openable from the "?" button in the toolbar.
//
// Adapted for a browsing context: there is no BLE pairing, no GPS and no
// capture here, so the basics are about reading someone else's coverage rather
// than producing your own.
import { calloutPosition, unionRect, avoidOverlap, overlapsAny } from './calloutPosition.js'

const SEEN_KEY = 'ch-onboarding-seen'

export const ONBOARDING_TITLE = 'Mesh-Hunter'

export const ONBOARDING_TAGLINE =
  'The shared coverage map: where MeshCore nodes have been heard, pooled from every hunter in the field. Hot = strong = the hunter was close when it heard that node.'

export const ONBOARDING_BASICS = [
  'Pick a time range and a sender to isolate one node',
  'Locate estimates where a node transmits from, out of the readings around it',
  'Nothing here is live radio — it is what hunters have already logged',
]

// AGENTS.md §7: the map implies node locations, so the disclaimer is part of the
// onboarding, not only of the node-position layer. Same wording as #nodepos-note.
export const ONBOARDING_DISCLAIMER =
  'Positions are inferred from radio measurements (RSSI/SNR) via mesh topology — not GPS tracking of the node. The coordinates are the hunter’s own position when it heard the node. Advertised positions are self-reported by their operators.'

// Each callout names the group of real controls it is anchored to. `targets`
// are element ids; the box is placed against the union of the ones present, so
// a control that is hidden for the current role simply drops out.
export const ONBOARDING_CALLOUTS = [
  {
    id: 'wb-co-filters',
    targets: ['hp-toggle', 'f-sender', 'sp-toggle', 'tr-toggle', 'f-types', 'f-direct'],
    side: 'below',
    align: 'left',
    text: 'Choose hunters and a sender, a time range, and which packet types to plot. Direct only keeps the zero-hop receptions that actually place a transmitter.',
  },
  {
    id: 'wb-co-layers',
    targets: ['layer-toggle', 'locate-toggle', 'cs-adverts', 'cs-relays', 'f-nodepos'],
    side: 'below',
    align: 'left',
    text: 'Switch points/hex/both. Locate — an origin estimate from the readings around a node — and the CoreScope and node-position overlays appear here once you are a verified member.',
  },
  {
    id: 'wb-co-account',
    targets: ['auth-btn'],
    side: 'below',
    align: 'right',
    text: 'Registering in the app makes you a hunter: filter to your own companion and you see its captures in full, everyone else stays coarse and 24 h. An admin verifies you as a member for the full history, Locate and the CoreScope layers.',
  },
]

// shouldShowOnboarding decides the first-run display. Only a stored
// acknowledgement suppresses it, so a reader who has never dismissed it sees it
// once — and the "?" button is what brings it back afterwards.
export function shouldShowOnboarding(seen) {
  return !seen
}

function loadSeen() {
  try { return localStorage.getItem(SEEN_KEY) } catch (_) { return null }
}

function saveSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch (_) {}
}

// Anchors every callout to its targets' current position, exactly as the app's
// positionCallouts() does. Re-run on resize while the overlay is open, because
// the toolbar wraps to a second row on a narrow window and every anchor moves.
//
// Blockers are the toolbar, the centre panel, and every callout already placed.
// The panel half was missing until review: between roughly 760 and 1000 px the
// panel is wide enough to reach the boxes but the window is not narrow enough
// to trip the old fixed-width fallback, so all three sat behind it with their
// text clipped mid-sentence — a band neither e2e viewport covered.
//
// The toolbar half was missing until #428, and cost more: every callout is
// side:'below', so a box anchored to a control on the bar's first row was
// placed straight over the bar's second row — including #auth-btn, the target
// the third callout points at. The tour hid the controls it was explaining, and
// avoidOverlap saw the position as clear because nothing had told it the bar
// was there. #bar as a whole rather than each control: it is full-width and
// avoidOverlap only moves boxes vertically, so per-control blockers would come
// to the same answer through more work.
//
// Read live rather than assumed to be one row: the bar wraps, and how many rows
// it has depends on the viewport and on content that arrives after load.
//
// There is no width constant any more. Whether the spotlight is usable is a
// question about the space that actually exists, so it is asked of the
// placement: if any box cannot be put somewhere clear, the copy goes into the
// panel instead. That answers 760x800 and 900x700 without guessing where the
// boundary lies.
export function positionCallouts() {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const panel = document.querySelector('.wb-panel')
  const bar = document.getElementById('bar')
  const blockers = []
  if (bar) blockers.push(bar.getBoundingClientRect())
  if (panel) blockers.push(panel.getBoundingClientRect())
  const boxes = []
  let spotlight = true
  for (const co of ONBOARDING_CALLOUTS) {
    const box = document.getElementById(co.id)
    if (!box) continue
    boxes.push(box)
    // Un-hide before measuring: a `hidden` box has a 0x0 rect, so a pass that
    // ran after the fallback kicked in would find nothing overlapping anything
    // and switch the spotlight back on, then off again on the next pass. The
    // decision below re-hides it in the same synchronous pass, so nothing paints
    // in between.
    box.hidden = false
    const rects = co.targets
      .map((id) => document.getElementById(id))
      .filter((elm) => elm && elm.getBoundingClientRect)
      .map((elm) => elm.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0)
    if (!rects.length) continue
    const size = box.getBoundingClientRect()
    const anchored = calloutPosition(unionRect(rects), viewport, size, co)
    const { top, left } = avoidOverlap(
      { ...anchored, width: size.width, height: size.height }, blockers, viewport,
    )
    const placed = { top, left, width: size.width, height: size.height }
    box.style.top = `${top}px`
    box.style.left = `${left}px`
    if (overlapsAny(placed, blockers)) spotlight = false
    blockers.push(placed)
  }
  for (const box of boxes) box.hidden = !spotlight
  const inline = document.getElementById('wb-inline')
  if (inline) inline.hidden = spotlight
}

// initOnboarding fills the static copy, wires the "?" button and the dismiss
// paths, and opens the overlay on a first visit.
export function initOnboarding() {
  const overlay = document.getElementById('wb-onboarding')
  const scrim = document.getElementById('wb-scrim')
  const help = document.getElementById('help-btn')
  if (!overlay || !scrim || !help) return

  document.getElementById('wb-title').textContent = ONBOARDING_TITLE
  document.getElementById('wb-tagline').textContent = ONBOARDING_TAGLINE
  document.getElementById('wb-disclaimer').textContent = ONBOARDING_DISCLAIMER
  document.getElementById('wb-basics').replaceChildren(
    ...ONBOARDING_BASICS.map((b) => { const li = document.createElement('li'); li.textContent = b; return li }),
  )
  for (const co of ONBOARDING_CALLOUTS) {
    const box = document.getElementById(co.id)
    if (box) box.textContent = co.text
  }
  // Same copy, filled once for the narrow layout that shows it in the panel.
  document.getElementById('wb-inline').replaceChildren(
    ...ONBOARDING_CALLOUTS.map((co) => {
      const li = document.createElement('li')
      li.textContent = co.text
      return li
    }),
  )

  // The ring is applied from the same `targets` lists the callouts are anchored
  // to, rather than from a selector list in the stylesheet — a spotlit control
  // and an anchored control cannot drift apart if there is only one list (#316
  // is that drift, in the app).
  function setSpots(on) {
    for (const co of ONBOARDING_CALLOUTS) {
      for (const id of co.targets) {
        const elm = document.getElementById(id)
        if (elm) elm.classList.toggle('wb-spot', on)
      }
    }
  }

  // index.html injects style.css from a module script, so a first-run tour can
  // open before that stylesheet has been applied — measured against an unstyled
  // toolbar, every callout lands ~30 px too high and points at nothing. Measure
  // again on the next frame, and once more at window load if the page is still
  // loading, so the boxes end up against the real layout.
  function reposition() {
    positionCallouts()
    requestAnimationFrame(() => positionCallouts())
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => { if (!overlay.hidden) positionCallouts() }, { once: true })
    }
  }

  // And the toolbar keeps moving after that: the role notice arrives with
  // /api/auth/me, the node counts and the server version land later still, and
  // each one reflows the bar and slides the controls the callouts point at. A
  // one-shot measurement is stale within a second of opening, so watch the bar
  // for as long as the tour is open and re-measure on the next frame.
  let pending = 0
  const schedule = () => {
    if (pending) return
    pending = requestAnimationFrame(() => { pending = 0; if (!overlay.hidden) positionCallouts() })
  }
  const barWatch = new MutationObserver(schedule)
  const bar = document.getElementById('bar')

  function open() {
    overlay.hidden = false
    scrim.hidden = false
    document.body.classList.add('wb-onboarding-on')
    help.setAttribute('aria-expanded', 'true')
    setSpots(true)
    reposition()
    if (bar) barWatch.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true })
    // Focus into the tour, and back to the opener on close — the pattern
    // whatsnew.js landed in #363. Without it a keyboard user on a first run is
    // left on <body>, with "Got it" behind the whole toolbar in tab order.
    document.getElementById('wb-got-it').focus()
  }

  function close() {
    overlay.hidden = true
    scrim.hidden = true
    document.body.classList.remove('wb-onboarding-on')
    help.setAttribute('aria-expanded', 'false')
    setSpots(false)
    barWatch.disconnect()
    saveSeen()
    help.focus()
  }

  help.addEventListener('click', () => (overlay.hidden ? open() : close()))
  // Operating a ringed control closes the tour. The controls stay live above
  // the scrim on purpose, but a callout sits over the popovers they open (the
  // hunter picker's rows were unclickable underneath one), and a tour that
  // blocks the control it is pointing at is worse than one that steps aside.
  if (bar) {
    bar.addEventListener('click', (e) => {
      if (!overlay.hidden && !help.contains(e.target)) close()
    })
  }
  document.getElementById('wb-close').addEventListener('click', close)
  document.getElementById('wb-got-it').addEventListener('click', close)
  // Clicking the dimmed map dismisses; clicking a callout, the panel or one of
  // the ringed controls lifted above the scrim does not — those are the tour.
  scrim.addEventListener('click', close)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close() })
  window.addEventListener('resize', () => { if (!overlay.hidden) positionCallouts() })

  if (shouldShowOnboarding(loadSeen())) open()
}
