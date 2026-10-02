// The Export sheet (#666): a list of the pictures the map can make of itself,
// opened from the Export button in #bar (in the menu below 900px, #561).
// Built like the settings sheet: the .lc-modal shell, focus kept inside while
// open and handed back to the button on close.
//
// Each item is { button, status, run, reason }: the ids of its button and
// its status line, the async export, which returns { blob, fileName }, or
// { empty: text } when there is nothing to draw, and throws when it cannot
// finish; and reason(), why the item cannot be used now, or null.
import { trapFocus } from './focustrap.js'

export function initExportSheet({ items }) {
  const btn = document.getElementById('export-btn')
  const modal = document.getElementById('export-modal')
  const close = document.getElementById('ex-close')
  if (!btn || !modal) return
  trapFocus(modal.querySelector('.lc-card'))

  const rows = items.map((it) => ({
    ...it,
    el: document.getElementById(it.button),
    line: document.getElementById(it.status),
    busy: false,
  })).filter((r) => r.el && r.line)
  const say = (row, text) => { row.line.textContent = text; row.line.hidden = !text }
  const sync = (row) => {
    const why = row.reason()
    row.el.disabled = row.busy || !!why
    if (!row.busy) say(row, why || '')
  }

  function open() {
    // Below 900px the button sits in the settings menu; the export sheet
    // takes its place rather than opening on top of it.
    const settings = document.getElementById('settings-modal')
    if (settings && !settings.hidden) settings.hidden = true
    modal.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    rows.forEach(sync)
    close.focus()
  }
  // Focus goes back to the button, or, below 900px where the button sits in
  // the settings menu that closed when this sheet opened, to that menu's
  // button: a focus on a hidden button is dropped on the body.
  function hide() {
    modal.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    const back = btn.offsetParent ? btn : document.getElementById('settings-btn')
    ;(back || btn).focus()
  }

  btn.addEventListener('click', () => (modal.hidden ? open() : hide()))
  close.addEventListener('click', hide)
  modal.addEventListener('click', (e) => { if (e.target === modal) hide() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) hide() })

  for (const row of rows) {
    row.el.addEventListener('click', async () => {
      if (row.busy) return
      row.busy = true
      row.el.disabled = true
      say(row, 'Drawing the map…')
      try {
        const out = await row.run()
        if (out.empty) { say(row, out.empty); return }
        download(out.blob, out.fileName)
        say(row, `Saved as ${out.fileName}`)
      } catch (err) {
        console.error('[export]', err)
        say(row, 'The picture could not be made. Try again in a moment.')
      } finally {
        row.busy = false
        row.el.disabled = !!row.reason()
      }
    })
  }
}

// A download the browser saves under `name`. The object URL outlives the
// click by a moment: a browser that starts the save asynchronously still
// finds it.
function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
