import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersions, isUpdateAvailable } from '../update.js'

describe('parseVersion', () => {
  it('reads the version out of the version.json payload', () => {
    expect(parseVersion('{"version":"0.13.0"}')).toBe('0.13.0')
  })
  it('returns null for malformed JSON', () => {
    expect(parseVersion('not json')).toBe(null)
    expect(parseVersion('')).toBe(null)
  })
  it('returns null when there is no usable version field', () => {
    expect(parseVersion('{"version":""}')).toBe(null)
    expect(parseVersion('{"version":123}')).toBe(null)
    expect(parseVersion('{}')).toBe(null)
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.13.0', '0.12.9')).toBe(1)
    expect(compareVersions('0.12.1', '0.12.0')).toBe(1)
    expect(compareVersions('0.12.0', '0.12.1')).toBe(-1)
    expect(compareVersions('0.12.0', '0.12.0')).toBe(0)
  })
  it('treats missing trailing components as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})

describe('isUpdateAvailable', () => {
  it('true only when latest is strictly newer than current', () => {
    expect(isUpdateAvailable('0.12.0', '0.13.0')).toBe(true)
    expect(isUpdateAvailable('0.12.0', '0.12.0')).toBe(false)
  })
  it('never nags on a null/blank or older latest (stale/failed fetch)', () => {
    expect(isUpdateAvailable('0.12.0', null)).toBe(false)
    expect(isUpdateAvailable('0.12.0', '')).toBe(false)
    expect(isUpdateAvailable('0.12.0', '0.11.0')).toBe(false)
  })
})
