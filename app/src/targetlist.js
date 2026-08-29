import { senderList, topSenders, relTime, targetParts, rowIds } from './feed.js'

const PAGE_SIZE = 6
const PINNED_COUNT = 3

// rowIds (feed.js) gives the lowercased ids a row answers to, which is how the
// selection set is keyed: a merged row (#267) is selected when any of its
// variants is in the current selection. The search matcher reads the same list,
// so what you can type an id into and what a tap selects cannot drift apart.

// A query that matches nothing says so. An empty list under a field you just
// typed into reads as "the list broke", not as "no node by that name".
function emptyRow() {
  const li = document.createElement('li')
  li.className = 'tl-empty'
  li.textContent = 'No senders match.'
  return li
}

function row(rec, nowMs, onSelect, selectedIds) {
  const li = document.createElement('li')
  li.className = 'tl-item'

  const ids = rowIds(rec)
  const selected = !!(selectedIds && ids.some((id) => selectedIds.has(id)))

  // The whole row toggles the target — a big touch target with a checkbox that
  // shows state. It reads as a toggle to assistive tech (aria-pressed).
  const btn = document.createElement('button')
  btn.type = 'button'; btn.className = 'tl-row'
  btn.classList.toggle('active', selected)
  btn.setAttribute('aria-pressed', String(selected))

  const check = document.createElement('span'); check.className = 'tl-check'; check.setAttribute('aria-hidden', 'true')

  const { primary, secondary } = targetParts(rec)
  const name = document.createElement('span'); name.className = 'tl-name'; name.textContent = primary

  // Second line: short id prefix + RSSI + time-ago, right-aligned together so
  // none of them ever overlaps the name line above (#215).
  const meta = document.createElement('span'); meta.className = 'tl-meta'
  if (secondary) {
    const prefix = document.createElement('span'); prefix.className = 'tl-prefix'; prefix.textContent = secondary
    meta.appendChild(prefix)
  }
  const rssi = document.createElement('span'); rssi.className = 'tl-rssi'
  rssi.textContent = String(rec.rssi ?? '—')
  const time = document.createElement('span'); time.className = 'tl-time'
  time.textContent = relTime(rec.rx_at, nowMs)
  meta.append(rssi, time)

  btn.append(check, name, meta)
  btn.addEventListener('click', () => onSelect && onSelect(rec.sender_id, rec.sender_label, ids))

  li.appendChild(btn)
  return li
}

// createTargetList wires the target-sheet dropdown:
// - pinnedEl: top senders by combined recency+RSSI score, at most PINNED_COUNT
//   rows regardless of scroll (may repeat entries from listEl). Hidden — with
//   pinnedLabelEl, its "Top" heading — when topSenders reports nothing,
//   i.e. when the section would repeat the whole list (#539).
// - listEl: the full sender list, name-sorted, lazily grown as the user
//   scrolls instead of rendering every sender ever heard up front.
// - searchEl: the query field (#449). Its value narrows listEl live.
// - browseEl: the browse-mode chrome (the pinned Top block and the list
//   heading), hidden while a query is active. Top ranks everything heard by
//   recency+RSSI, which is not a ranking of the matches; showing both invites
//   picking the wrong row.
// selectedIds is the Set of lowercased target ids (multi-select, #178); each
// row reflects membership and the whole row toggles it.
export function createTargetList(listEl, { onSelect, pinnedEl, pinnedLabelEl, searchEl, browseEl } = {}) {
  let visible = PAGE_SIZE
  let lastRows = []
  let lastIgnore = new Set()
  let lastSelected = null
  let _lastSig = null
  let _lastPinnedSig = null

  const selSig = (sel) => (sel ? [...sel].sort().join(',') : '')
  const query = () => (searchEl ? String(searchEl.value || '').trim() : '')

  function render(rows, ignore, nowMs, selectedIds) {
    lastRows = rows
    lastIgnore = ignore
    lastSelected = selectedIds || null
    const selKey = selSig(lastSelected)
    const q = query()
    if (browseEl) browseEl.hidden = q !== ''

    if (pinnedEl && !q) {
      const pinned = topSenders(rows, { ignore, count: PINNED_COUNT, nowMs })
      pinnedEl.hidden = pinned.length === 0
      if (pinnedLabelEl) pinnedLabelEl.hidden = pinned.length === 0
      const pinnedSig = pinned.map((r) => (r.sender_label || r.sender_id || '') + r.rssi + r.rx_at).join('|') + '@' + selKey
      if (pinnedSig !== _lastPinnedSig) {
        _lastPinnedSig = pinnedSig
        pinnedEl.replaceChildren(...pinned.map((rec) => row(rec, nowMs, onSelect, lastSelected)))
      }
    }

    const items = senderList(rows, { ignore, limit: visible, query: q })
    const sig = items.map((r) => (r.sender_label || r.sender_id || '') + r.rssi + r.rx_at).join('|') + '#' + visible + '@' + selKey + '?' + q
    if (sig === _lastSig) return
    _lastSig = sig
    if (q && items.length === 0) { listEl.replaceChildren(emptyRow()); return }
    listEl.replaceChildren(...items.map((rec) => row(rec, nowMs, onSelect, lastSelected)))
  }

  // Reset back to the first page — call when the sheet is (re)opened.
  function reset() {
    visible = PAGE_SIZE
    _lastSig = null
    _lastPinnedSig = null
  }

  // Typing is a new list: page from the top of the matches rather than from
  // wherever the unfiltered list had been scrolled to.
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      visible = PAGE_SIZE
      _lastSig = null
      listEl.scrollTop = 0
      render(lastRows, lastIgnore, Date.now(), lastSelected)
    })
  }

  listEl.addEventListener('scroll', () => {
    if (listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 24) return
    const total = senderList(lastRows, { ignore: lastIgnore, query: query() }).length
    if (visible >= total) return
    visible += PAGE_SIZE
    _lastSig = null
    render(lastRows, lastIgnore, Date.now(), lastSelected)
  })

  return { render, reset }
}
