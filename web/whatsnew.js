// "What's new" badge + panel (#284). The version in the footer gets a dot when
// the deployed VERSION is newer than the one this browser last acknowledged;
// clicking it opens the release notes parsed out of the CHANGELOG.md that
// release-please already generates. Storage-guarded like urlstate.js — a
// storage-hostile context loses the acknowledgement, not the page.
//
// The changelog is fetched on first open rather than at load: it is 16 kB of
// text nobody reads on a normal visit, and the badge itself only needs the two
// version strings.
import { VERSION } from './version.js'
import { parseChangelog, hasUnseen, unseenCount } from './changelog.js'

const SEEN_KEY = 'ch-whatsnew-seen'
// The panel lists this many releases; the rest are one click away on GitHub.
const LIMIT = 10
const RELEASES_URL = 'https://github.com/efiten/core-hunter/releases'

function loadSeen() {
  try { return localStorage.getItem(SEEN_KEY) } catch (_) { return null }
}

function saveSeen(version) {
  try { localStorage.setItem(SEEN_KEY, version) } catch (_) {}
}

// Built as DOM, not innerHTML: the items are changelog prose that has already
// been stripped of its links, so they are text and are rendered as text.
function renderReleases(body, releases, seen) {
  const fresh = unseenCount(releases, seen)
  body.replaceChildren()
  releases.slice(0, LIMIT).forEach((rel, i) => {
    const head = document.createElement('h5')
    head.className = 'wn-version'
    head.textContent = `v${rel.version}`
    if (rel.date) {
      const date = document.createElement('span')
      date.className = 'wn-date'
      date.textContent = rel.date
      head.appendChild(date)
    }
    if (i < fresh) {
      const tag = document.createElement('span')
      tag.className = 'wn-new'
      tag.textContent = 'new'
      head.appendChild(tag)
    }
    body.appendChild(head)
    for (const section of rel.sections) {
      const title = document.createElement('h6')
      title.className = 'wn-section'
      title.textContent = section.title
      body.appendChild(title)
      const list = document.createElement('ul')
      list.className = 'wn-items'
      for (const item of section.items) {
        const li = document.createElement('li')
        li.textContent = item
        list.appendChild(li)
      }
      body.appendChild(list)
    }
  })
  const more = document.createElement('a')
  more.className = 'wn-more'
  more.href = RELEASES_URL
  more.target = '_blank'
  more.rel = 'noopener'
  more.textContent = releases.length > LIMIT
    ? `Older releases (${releases.length - LIMIT} more) on GitHub`
    : 'All releases on GitHub'
  body.appendChild(more)
}

// initWhatsNew wires the footer version button, the dot and the modal. Called
// from index.html once the footer version text has been set.
export function initWhatsNew() {
  const btn = document.getElementById('ch-version')
  const dot = document.getElementById('wn-dot')
  const modal = document.getElementById('whatsnew-modal')
  const body = document.getElementById('wn-body')

  // Read once, before the first open acknowledges the running version: this is
  // what tells the panel which releases are new to this reader. A first visit
  // records the version silently — a new user has no "since you were last
  // here", and a badge on their very first load would be noise.
  const seen = loadSeen()
  if (!seen) saveSeen(VERSION)
  function refreshBadge() {
    const unseen = hasUnseen(VERSION, loadSeen())
    dot.hidden = !unseen
    // Re-read storage rather than close over the boot value: opening the panel
    // acknowledges the version, and a title still reading "updated since you
    // last looked" next to a hidden dot is the two halves disagreeing.
    btn.title = unseen ? `What's new in v${VERSION} — updated since you last looked` : "What's new"
  }
  refreshBadge()

  let releases = null
  async function open() {
    modal.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    saveSeen(VERSION)
    refreshBadge()
    // aria-modal tells assistive tech the page behind is inert, so focus has to
    // actually move — otherwise a keyboard user is left tabbing through a page
    // they have just been told is not there. Same as login.js, which focuses
    // its first field on open.
    document.getElementById('wn-close').focus()
    if (releases) return
    try {
      const res = await fetch(`CHANGELOG.md?v=${VERSION}`)
      if (!res.ok) throw new Error(String(res.status))
      releases = parseChangelog(await res.text())
      renderReleases(body, releases, seen)
    } catch (_) {
      // The changelog is a static file next to index.html; a miss means a
      // deploy that did not copy it, so say where the notes are instead of
      // showing an empty dialog.
      body.replaceChildren()
      const link = document.createElement('a')
      link.className = 'wn-more'
      link.href = RELEASES_URL
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = 'Release notes on GitHub'
      body.appendChild(link)
    }
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
