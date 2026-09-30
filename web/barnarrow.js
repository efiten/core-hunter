// What the map's bar hands off below 768px (#561, #727), and Export already
// below 900px (#666).
//
// The bar is one row at every width now, and at 375px a row cannot hold four
// filter controls, a brand, a primary action, a login and two icon buttons:
// measured on the artboard, the phone row has 322px of content on a 375px
// screen with the group at two segments. Which two is not a new decision --
// the app's #topbar-controls has carried exactly Select target and Filters at
// that width since #305.
//
// Everything else is MOVED, not copied. One control is one element: a second
// instance would be two things to keep in step, two places to read the state
// from, and the kind of drift docs/design-system.md exists to stop. It is also
// what keeps the popovers working, since placePopover measures the toggle's own
// box (#372, #385) -- a toggle that was hidden instead would have no box at all,
// and a duplicated one would anchor the panel to whichever copy was found first.
//
// Where each goes is the ordinary overflow-menu pattern: what narrows the view
// goes into the filter panel, which is a full-width sheet at this width
// already; what acts goes into the menu.

// `into` is where the slot lives, and it is in the table rather than inferred
// so the guard in barnarrow.test.js can check each slot really is inside the
// container it claims: a slot that drifted out of both would move a control
// somewhere nothing ever opens.
//
// `wrap`, where set, is the ancestor of `control` that moves. The hunter
// picker's wrapper has no hook of its own, so it is reached from its toggle.
// Not with `.ms-wrap:has(#hp-toggle)`: querySelector throws on a selector the
// engine cannot parse rather than matching nothing. Where `:has()` is missing
// that left the bar half moved, and because map.js applies this while it loads,
// it stopped map.js at that line too, at every width.
export const NARROW_SLOTS = [
  { control: '.tr-wrap', slot: 'bf-slot-time', group: 'bf-group-time', into: 'panel' },
  { control: '#hp-toggle', wrap: '.ms-wrap', slot: 'bf-slot-hunters', group: 'bf-group-hunters', into: 'panel' },
  // Export is the first to go (#666). It is the least used action, and between
  // 641 and 900px its label is what wraps the bar into another row: measured
  // at 768px as a guest in a font as wide as the CI runner's, 90px with it in
  // the bar against 64px without.
  { control: '#export-btn', slot: 'ss-slot-actions', group: 'ss-slot-actions', into: 'menu', below: 900 },
  { control: '#rx-cta', slot: 'ss-slot-actions', group: 'ss-slot-actions', into: 'menu' },
  { control: '#auth-btn', slot: 'ss-slot-actions', group: 'ss-slot-actions', into: 'menu' },
]

// Where each destination lives in index.html, for that guard.
export const NARROW_CONTAINERS = { panel: 'bar-filters', menu: 'settings-modal' }

// The width the other controls leave the bar below: map.js's "is this a
// phone" line (NARROW_MEDIA below).
export const NARROW_PX = 767

// Where each control came from, recorded the first time it leaves.
//
// The parent's whole original child order, not the control's index in it: two
// controls come out of the same group, and the second one's recorded index is
// already stale by the time the first has left. Restoring by index then put the
// time range back after the Filters pill instead of before it, which moves
// every divider the group draws. Recording the order and inserting before the
// first later sibling that is currently home is right whatever order they move
// in, and however many of them there are.
const home = new WeakMap()   // control -> its original parent
const order = new WeakMap()  // parent -> its original children, as an array

export function findControl({ control, wrap }, root = document) {
  const el = root.querySelector(`#bar ${control}`) || root.querySelector(control)
  return el && wrap ? el.closest(wrap) : el
}

// A popover open on a control that is about to move would be left anchored to
// where the control used to be -- and moving into the filter panel takes it
// somewhere `display:none` while the toggle still says aria-expanded="true".
// Closing it is the honest state: the control is somewhere else now.
function closePopover(el) {
  for (const panel of el.querySelectorAll('.tl-panel, .tr-panel')) panel.hidden = true
  for (const toggle of el.querySelectorAll('[aria-expanded="true"]')) toggle.setAttribute('aria-expanded', 'false')
}

// The first of el's original later siblings that is currently in the parent, or
// null to append. Skipping the ones that are still away is what lets several
// controls go home in any order.
function nextSiblingAtHome(parent, el) {
  const siblings = order.get(parent) || []
  for (let i = siblings.indexOf(el) + 1; i > 0 && i < siblings.length; i++) {
    if (siblings[i].parentElement === parent) return siblings[i]
  }
  return null
}

// applyNarrowBar puts each control in its slot when narrowAt(width) says the
// viewport is below the width it leaves at, and home otherwise.
export function applyNarrowBar(narrowAt) {
  if (!document.getElementById('bar')) return
  for (const entry of NARROW_SLOTS) {
    const { slot, group } = entry
    const narrow = narrowAt(entry.below || NARROW_PX)
    const el = findControl(entry)
    const target = document.getElementById(slot)
    const groupEl = document.getElementById(group)
    if (!el || !target || !groupEl) continue
    if (narrow) {
      if (el.parentElement !== target) {
        if (!home.has(el)) {
          const parent = el.parentElement
          if (!order.has(parent)) order.set(parent, [...parent.children])
          home.set(el, parent)
        }
        closePopover(el)
        target.appendChild(el)
      }
    } else {
      const parent = home.get(el)
      if (parent && el.parentElement !== parent) {
        closePopover(el)
        parent.insertBefore(el, nextSiblingAtHome(parent, el))
      }
    }
    // A slot two controls share is shown once either of them is in it, and
    // hidden only when both have gone home.
    groupEl.hidden = !target.children.length
  }
}

// The one line the map answers "is this a phone" with: the bar, the ticker and
// the notices all hang off it. Up to 767px, below a tablet. It was 640 until
// #727: between 641 and 729px the wide bar wrapped to two or three rows (76 to
// 90px) with CI's wider font, which is a phone held sideways. The stylesheet
// repeats the number in its @media rules, since CSS cannot import it.
export const NARROW_MEDIA = `(max-width: ${NARROW_PX}px)`

// Wires the rule to the viewport and applies it once. `mq` is the shared
// NARROW_MEDIA query; a control that leaves earlier gets a query of its own.
// The listeners are never removed: the bar lives as long as the page does.
export function wireNarrowBar(mq = window.matchMedia(NARROW_MEDIA)) {
  const queries = new Map([[NARROW_PX, mq]])
  for (const { below } of NARROW_SLOTS) {
    if (below && !queries.has(below)) queries.set(below, window.matchMedia(`(max-width: ${below}px)`))
  }
  const apply = () => applyNarrowBar((px) => queries.get(px).matches)
  apply()
  for (const q of queries.values()) q.addEventListener('change', apply)
  return mq
}
