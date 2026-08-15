import { describe, it, expect } from 'vitest'
import { packetTypeLabel, FILTER_PACKET_TYPES } from './packettypes.js'
import { FILTER_PACKET_TYPES as APP_PACKET_TYPES } from '../app/src/filters.js'

describe('packetTypeLabel', () => {
  it('maps a raw decoder packet_type to its friendly filter-chip label', () => {
    expect(packetTypeLabel('TextMessage')).toBe('Direct msg')
    expect(packetTypeLabel('GroupText')).toBe('Channel')
    expect(packetTypeLabel('Advert')).toBe('Advert')
  })
  it('falls back to the raw value for an unrecognised packet_type', () => {
    expect(packetTypeLabel('SomethingNew')).toBe('SomethingNew')
  })
  it('falls back to the raw value for null/undefined', () => {
    expect(packetTypeLabel(null)).toBe(null)
    expect(packetTypeLabel(undefined)).toBe(undefined)
  })
})

describe('FILTER_PACKET_TYPES', () => {
  // This list is a hand-kept copy of the app's (the two are merged by #238);
  // until then the only thing keeping them from drifting is this assertion.
  it('is the same set, in the same order, as the app filter sheet', () => {
    expect(FILTER_PACKET_TYPES).toEqual(APP_PACKET_TYPES)
  })
})
