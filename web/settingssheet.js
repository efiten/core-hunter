// The settings surface (#420): which tab the sheet opens on, and the glue that
// opens it. Web had no settings surface at all — every meta control lived in
// #bar, so anything that was not a filter had nowhere else to go.
//
// initialSettingsTab is DUPLICATED from app/src/settings.js and pinned to it by
// parity.test.js. Only this one function is shared: the app's settings.js also
// carries loaders for the attenuator, the sound mode and the view index, none
// of which exist on web, so copying the module whole would import dead code.
// The parity assertion is therefore on the behaviour that must agree, not on
// the export set.

import { trapFocus } from './focustrap.js'

// initialSettingsTab picks the tab the sheet opens on. Unread release notes
// win once: opening that tab acknowledges them, so the next open finds
// unseenChangelog false and lands back on Settings. Without that write this
// would strand the reader on the notes every single time.
export function initialSettingsTab({ unseenChangelog } = {}) {
  return unseenChangelog ? 'whatsnew' : 'settings'
}

const TABS = ['settings', 'whatsnew', 'about']

// initSettingsSheet wires the entry point, the tabs and the dismiss paths.
// `whatsNew` is what initWhatsNew() returned — the notes own their content and
// their unread state; this owns the window around them.
export function initSettingsSheet(whatsNew) {
  const btn = document.getElementById('settings-btn')
  const modal = document.getElementById('settings-modal')
  const close = document.getElementById('ss-close')
  if (!btn || !modal) return
  // aria-modal tells assistive tech the page behind is inert, so Tab has to
  // agree — without this, two presses from Close reached the map, then the
  // attribution links, then the filter bar. Attached to the card because that
  // is the element carrying role="dialog"; the scrim around it holds nothing
  // focusable of its own, so either would behave the same today.
  trapFocus(modal.querySelector('.lc-card'))

  const tab = (k) => document.getElementById('ss-tab-' + k)
  const panel = (k) => document.getElementById('ss-panel-' + k)

  function selectTab(which) {
    for (const k of TABS) {
      const on = k === which
      tab(k).classList.toggle('active', on)
      tab(k).setAttribute('aria-selected', String(on))
      panel(k).classList.toggle('active', on)
      panel(k).hidden = !on
    }
    // Not awaited: the tab is already switched and the panel renders into
    // itself when the fetch lands. load() handles its own failure, so there is
    // no rejection to leak.
    if (which === 'whatsnew') void whatsNew.load()
  }
  for (const k of TABS) tab(k).addEventListener('click', () => selectTab(k))

  function open() {
    modal.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    // Which tab opens has to be decided AFTER the badge is re-read, or it
    // answers with the flag the previous open left behind.
    whatsNew.refreshBadge()
    selectTab(initialSettingsTab({ unseenChangelog: whatsNew.unseen() }))
    // Focus has to actually move in, not only be kept in: a keyboard user who
    // opens the sheet and starts tabbing must start inside it. Same as
    // login.js.
    close.focus()
  }

  function hide() {
    modal.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    // Back to the control that opened it, so Escape or Close does not drop the
    // keyboard user at the top of the document.
    btn.focus()
  }

  btn.addEventListener('click', () => (modal.hidden ? open() : hide()))
  close.addEventListener('click', hide)
  // Click on the scrim (the modal element itself, not the card) closes, like
  // the login modal's Cancel; Escape closes too.
  modal.addEventListener('click', (e) => { if (e.target === modal) hide() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) hide() })

  // The walkthrough lives behind this sheet, so opening it with the sheet still
  // up would hide the very controls it points at. onboarding.js keeps its own
  // handler on the same button; this only gets the sheet out of the way.
  const help = document.getElementById('help-btn')
  if (help) help.addEventListener('click', hide)
}
