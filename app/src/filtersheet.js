// The filter sheet's structure (#564).
//
// Extracted from app.js so the thing the issue is actually about -- which
// groups there are, in which order, under which words -- is a value a test can
// read, rather than a template string buried in a 2500-line module. The map's
// panel is the same list in the same order, and web/parity.test.js reads both.
//
// The map adds View and Hunters after these, and they stay map-only: they are
// analysis, and the map is the superset (docs/design-system.md). Its Overlays
// group went when node positions moved to the rail (#630).

import { TIME_WINDOWS, windowMs } from './timewindows.js'

// The order both panels follow. Time first because it is the widest cut, then
// what the traffic is, then who sent it, then the two narrowing switches, then
// who is silenced.
export const FILTER_GROUPS = ['Time', 'Traffic types', 'Sender id', 'Only show', 'Ignored senders']

// After the shared groups, the app's own, as View is the map's. Map holds the
// noise layer (#410): a setting rather than a filter, here until the map has
// settings of its own (Kasper, 2026-09-25), so Clear filters leaves it alone.
export const APP_ONLY_GROUPS = ['Map']

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
            ${TIME_WINDOWS.map((w) => `<option value="${windowMs(w.token)}">${w.label}</option>`).join('')}
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
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Ignored senders</div>
        <div class="ss-ignore-section">
          <div id="ss-ignore-list"></div>
          <button id="ss-ignore-clear">Clear ignore-list</button>
        </div>
      </div>
      <div class="fs-group">
        <div class="fs-group-head">Map</div>
        <label class="fs-row" id="fs-row-noise">
          <input type="checkbox" id="fs-noise" />
          <span>Noise floor</span>
        </label>
        <p class="ss-hint">Colours the cells by the noise your companion measured there, instead of by signal. Loud cells explain a stretch with nothing heard.</p>
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
