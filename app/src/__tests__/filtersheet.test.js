import { describe, it, expect } from 'vitest'
import { FILTER_GROUPS, filterSheetMarkup, groupHeadings } from '../filtersheet.js'
import { FILTER_PACKET_TYPES, SENDER_ID_CLASSES } from '../filters.js'

// #564: the two panels held different things, in a different order, under
// different words. The order is the subject, so it is a value rather than a
// shape buried in a template.

const html = () => filterSheetMarkup({ types: FILTER_PACKET_TYPES, idClasses: SENDER_ID_CLASSES })

describe('the filter sheet structure', () => {
  it('renders the groups FILTER_GROUPS names, in that order', () => {
    // Read back out of the markup, so the list cannot claim an order the sheet
    // does not have.
    expect(groupHeadings(html())).toEqual(FILTER_GROUPS)
  })

  it('gives every group a heading', () => {
    const groups = (html().match(/class="fs-group"/g) || []).length
    expect(groupHeadings(html()).length).toBe(groups)
  })

  it('says Traffic types, not Types', () => {
    // One vocabulary: the map has always said Traffic types.
    expect(FILTER_GROUPS).toContain('Traffic types')
    expect(FILTER_GROUPS).not.toContain('Types')
  })

  it('opens both chip rows on All', () => {
    // "Everything" has one representation, and it is the state a fresh sheet is
    // in — not a row with nothing lit.
    expect(html()).toContain('<button class="fs-chip active" data-type="all">All</button>')
    expect(html()).toContain('<button class="fs-chip active" data-idclass="all">All</button>')
  })

  it('carries a count and a Clear, which the app had neither of', () => {
    expect(html()).toContain('id="fs-count"')
    expect(html()).toContain('id="fs-clear"')
    expect(html()).toContain('id="fs-types-more"')
  })

  it('renders every packet type and sender-id class', () => {
    const h = html()
    for (const t of FILTER_PACKET_TYPES) expect(h, t.value).toContain(`data-type="${t.value}"`)
    for (const c of SENDER_ID_CLASSES) expect(h, c.value).toContain(`data-idclass="${c.value}"`)
  })
})
