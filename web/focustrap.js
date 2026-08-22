// Keeping Tab inside an open dialog (#420 review).
//
// A dialog that sets aria-modal="true" tells assistive tech the page behind it
// is inert. Tab has to agree, or a keyboard user is walked straight out of the
// dialog and through content a screen reader has just been told is not there.
// Measured on the settings sheet before this existed: two presses from the
// Close button reached the map, then the attribution links, then the filter
// bar.
//
// Shared rather than copied, because both dialogs on this page have the gap:
// the settings sheet is the one that introduces aria-modal, and login.js
// focuses its first field and nothing else.

// What can hold focus. `:not([disabled])` rather than a runtime check so the
// selector answers the common cases on its own.
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// focusableIn is the set as it stands right now, which is not the same as the
// set the selector matches: the sheet is tabbed, so two of its three panels are
// `hidden` at any moment and their controls must not be tabbed into. The check
// is offsetParent, the cheap "is not rendered" test — display:none, a hidden
// ancestor and `hidden` itself all answer null, and a dialog's contents are
// never position:fixed, which is the one case that would answer null while
// visible.
export function focusableIn(root) {
  if (!root) return []
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
}

// nextFocus decides where Tab should land, or null to let the browser do it —
// which is every press except the two at the ends. Kept separate from the DOM
// so the wrap-around, the direction and the "focus is not in here yet" case
// are testable without a browser.
export function nextFocus(items, active, back = false) {
  if (!items || !items.length) return null
  const i = items.indexOf(active)
  // Focus is somewhere the trap does not know about — the body after a click
  // on the scrim, or an element that has just been hidden. Pull it back to the
  // edge rather than leaving it outside.
  if (i === -1) return back ? items[items.length - 1] : items[0]
  if (back) return i === 0 ? items[items.length - 1] : null
  return i === items.length - 1 ? items[0] : null
}

// trapFocus holds Tab and Shift+Tab inside `root`.
//
// Attached once and left there, like the Escape handler beside it, rather than
// added on open and removed on close. The listener is on `root`, and a
// keypress only reaches it while focus is inside — which is only while the
// dialog is open, since both dialogs move focus back to their trigger when
// they close. So there is no state to keep and nothing to release.
export function trapFocus(root) {
  if (!root) return
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const target = nextFocus(focusableIn(root), document.activeElement, e.shiftKey)
    if (!target) return
    e.preventDefault()
    target.focus()
  })
}
