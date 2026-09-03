// The filter sheet's structure (#564).
//
// Extracted from app.js so the thing the issue is actually about -- which
// groups there are, in which order, under which words -- is a value a test can
// read, rather than a template string buried in a 2500-line module. The map's
// panel is the same list in the same order, and web/parity.test.js reads both.
//
// The map adds Overlays and View after these, and they stay map-only: they are
// analysis, and the map is the superset (docs/design-system.md).

// The order both panels follow. Time first because it is the widest cut, then
// what the traffic is, then who sent it, then the two narrowing switches, then
// who is silenced.
export const FILTER_GROUPS = ['Time', 'Traffic types', 'Sender id', 'Only show', 'Ignored senders']

// One vocabulary across the surfaces: the app said "Types" where the map says
// "Traffic types", and the app labelled only its two chip rows while the map
// gave every group a heading.
export function filterSheetMarkup({ types, idClasses }) {
  const chips = (attr, items) => `
          <button class="fs-chip active" data-${attr}="all">All</button>
          ${items.map((t) => `<button class="fs-chip" data-${attr}="${t.value}">${t.label}</button>`).join('')}`
  return `
    <div class="filter-sheet-inner">
      <div class="sheet-head">
        <h2>Filters</h2>
        <span id="fs-count" class="fs-count" hidden></span>
        <button class="sheet-close" id="fs-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Time</div>
        <label class="fs-row" id="fs-row-window">
          <span>Plot last</span>
          <select id="fs-window">
            <option value="600000">10 min</option>
            <option value="1800000">30 min</option>
            <option value="3600000">1 h</option>
            <option value="0">All time</option>
          </select>
        </label>
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Traffic types <span id="fs-types-count" class="fs-group-count" hidden></span></div>
        <div id="fs-type-chips" class="fs-type-chips">${chips('type', types)}
        </div>
        <button id="fs-types-more" class="fs-types-more" type="button" hidden></button>
      </div>
      <div class="fs-group" title="How far the sender can be identified: one byte is a 1-in-256 guess, a pubkey is unique.">
        <div class="fs-group-head">Sender id</div>
        <div id="fs-idclass-chips" class="fs-type-chips">${chips('idclass', idClasses)}
        </div>
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Only show</div>
        <label class="fs-row" id="fs-row-direct" title="Only receptions carrying no path at all. The path is written by the sender, so this is what the packet claims, not a measurement of distance.">
          <input type="checkbox" id="fs-direct-only" />
          <span>No path</span>
        </label>
        <label class="fs-row" id="fs-row-unnamed" title="Only receptions nothing could be attributed to. A flood sent with 1-byte path hashes leaves no sender at all, and this is the handle it has.">
          <input type="checkbox" id="fs-unnamed" />
          <span>Sender unknown</span>
        </label>
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Ignored senders</div>
        <div class="ss-ignore-section">
          <div id="ss-ignore-list"></div>
          <button id="ss-ignore-clear">Clear ignore-list</button>
        </div>
      </div>
      <div class="fs-foot">
        <span class="fs-live">Changes apply immediately</span>
        <button id="fs-clear" type="button" title="Clear all filters">Clear filters</button>
      </div>
    </div>`
}

// The headings the markup actually renders, in order. Read from the string
// rather than declared twice, so FILTER_GROUPS above cannot claim an order the
// sheet does not have.
export function groupHeadings(html) {
  return [...html.matchAll(/<div class="fs-group-head"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => m[1].replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/<[^>]+>/g, '').trim())
}
