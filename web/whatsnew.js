// "What's new" badge + panel (#284, rewritten for #422). The version in the
// footer gets a dot when changelog.json has an entry this browser has not
// acknowledged; clicking it opens the notes.
//
// The source used to be the release-please CHANGELOG.md, and the panel read
// like the commit log it was. It is a hand-written list of user-visible
// changes now — see changelog.js. That also changes when it loads: the dot
// asks whether the newest ENTRY is the acknowledged one, which is a question
// about the file, so it is fetched at boot rather than on first open. The
// curated file is a few kB where the raw changelog was 16.
import { VERSION } from './version.js'
import { whereLabel, hasUnseenEntries, unseenEntryCount, migratedSeenId } from './changelog.js'

// Entry ids live under their own key. The pre-#422 key held a VERSION string,
// and once the two share a slot there is no telling '1.8.0' from a
// date-prefixed slug — which is exactly the distinction migratedSeenId needs.
const SEEN_KEY = 'ch-whatsnew-entry'
const LEGACY_KEY = 'ch-whatsnew-seen'
// The panel lists this many entries; the rest are one click away on GitHub.
const LIMIT = 10
const RELEASES_URL = 'https://github.com/efiten/core-hunter/releases'
const FEEDBACK_URL = 'https://github.com/efiten/core-hunter/issues/new'

function loadSeen() {
  try { return localStorage.getItem(SEEN_KEY) } catch (_) { return null }
}

function saveSeen(entryId) {
  try { localStorage.setItem(SEEN_KEY, entryId) } catch (_) {}
}

// Read-only, and only to answer "has this reader used the old panel?". Never
// written again, so it ages out on its own.
function loadLegacyAck() {
  try { return localStorage.getItem(LEGACY_KEY) } catch (_) { return null }
}

// Built as DOM, not innerHTML: the entries are hand-written prose from a file
// in the repo, and prose is rendered as text.
function renderEntries(body, entries, seen) {
  const fresh = unseenEntryCount(entries, seen)
  body.replaceChildren()

  // Above the entries, not below them (#422): a reader who has just been told
  // what changed is the one most likely to have an opinion about it, and a
  // link under ten entries is a link nobody scrolls to.
  const ask = document.createElement('a')
  ask.className = 'wn-feedback'
  ask.href = FEEDBACK_URL
  ask.target = '_blank'
  ask.rel = 'noopener'
  ask.textContent = 'Found a bug, or want something? Open an issue on GitHub'
  body.appendChild(ask)

  entries.slice(0, LIMIT).forEach((entry, i) => {
    const head = document.createElement('h5')
    head.className = 'wn-version'
    head.textContent = entry.title
    if (i < fresh) {
      const tag = document.createElement('span')
      tag.className = 'wn-new'
      tag.textContent = 'new'
      head.appendChild(tag)
    }
    body.appendChild(head)

    const meta = document.createElement('div')
    meta.className = 'wn-meta'
    const date = document.createElement('span')
    date.className = 'wn-date'
    date.textContent = entry.date || ''
    meta.appendChild(date)
    const where = whereLabel(entry.where)
    if (where) {
      const tag = document.createElement('span')
      tag.className = 'wn-where'
      tag.textContent = where
      meta.appendChild(tag)
    }
    body.appendChild(meta)

    const text = document.createElement('p')
    text.className = 'wn-body-text'
    text.textContent = entry.body || ''
    body.appendChild(text)
  })

  const more = document.createElement('a')
  more.className = 'wn-more'
  more.href = RELEASES_URL
  more.target = '_blank'
  more.rel = 'noopener'
  more.textContent = 'Full technical history on GitHub'
  body.appendChild(more)
}

// initWhatsNew wires the footer version button, the dot and the modal. Called
// from index.html once the footer version text has been set.
export function initWhatsNew() {
  const btn = document.getElementById('ch-version')
  const dot = document.getElementById('wn-dot')
  const modal = document.getElementById('whatsnew-modal')
  const body = document.getElementById('wn-body')

  // Read once, before the first open acknowledges the newest entry: this is
  // what tells the panel which entries are new to this reader.
  const seen = loadSeen()
  let entries = null

  function refreshBadge() {
    const unseen = hasUnseenEntries(entries, loadSeen())
    dot.hidden = !unseen
    // Re-read storage rather than close over the boot value: opening the panel
    // acknowledges the newest entry, and a title still reading "updated since
    // you last looked" next to a hidden dot is the two halves disagreeing.
    btn.title = unseen ? "What's new — updated since you last looked" : "What's new"
  }
  refreshBadge()

  // Fetched at boot, because the dot depends on the file. A failure leaves the
  // dot hidden and `entries` null; open() then renders the fallback link
  // rather than an empty dialog.
  const loaded = fetch(`changelog.json?v=${VERSION}`)
    .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
    .then((json) => {
      entries = Array.isArray(json) ? json : []
      // A first visit records the newest id silently — a new reader has no
      // "since you were last here". A reader carrying the old version-string
      // acknowledgement stores nothing, so they get the dot once and find out
      // the notes are readable now.
      const migrated = migratedSeenId(seen, loadLegacyAck(), entries[0] && entries[0].id)
      if (migrated && migrated !== seen) saveSeen(migrated)
      refreshBadge()
    })
    .catch(() => {})

  async function open() {
    modal.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    // aria-modal tells assistive tech the page behind is inert, so focus has to
    // actually move — otherwise a keyboard user is left tabbing through a page
    // they have just been told is not there. Same as login.js, which focuses
    // its first field on open.
    document.getElementById('wn-close').focus()
    await loaded
    if (entries && entries.length) {
      if (entries[0].id) saveSeen(entries[0].id)
      refreshBadge()
      renderEntries(body, entries, seen)
      return
    }
    // changelog.json is a static file next to index.html; a miss means a deploy
    // that did not copy it, so say where the notes are instead of showing an
    // empty dialog.
    body.replaceChildren()
    const link = document.createElement('a')
    link.className = 'wn-more'
    link.href = RELEASES_URL
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = 'Release notes on GitHub'
    body.appendChild(link)
  }

  function close() {
    modal.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    // Back to the control that opened it, so Escape or Close does not drop the
    // keyboard user at the top of the document.
    btn.focus()
  }

  btn.addEventListener('click', open)
  document.getElementById('wn-close').addEventListener('click', close)
  // Click on the scrim (the modal element itself, not the card) closes, like
  // the login modal's Cancel; Escape closes too.
  modal.addEventListener('click', (e) => { if (e.target === modal) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close() })
}
