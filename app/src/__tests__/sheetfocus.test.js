import { describe, it, expect, vi } from 'vitest'
import { closeSheet } from '../sheetfocus.js'

// A stand-in for a sheet and its toggle: the sheet holds a set of elements.
const setup = (focusInside) => {
  const field = { id: 'ts-search' }, outside = { id: 'map' }
  const sheet = { hidden: false, contains: (x) => x === field }
  const toggle = { focus: vi.fn() }
  const doc = { activeElement: focusInside ? field : outside }
  return { sheet, toggle, doc }
}

describe('closeSheet (#714)', () => {
  it('hands the focus back to the toggle when it was inside the sheet', () => {
    const { sheet, toggle, doc } = setup(true)
    closeSheet(sheet, toggle, doc)
    expect(sheet.hidden).toBe(true)
    expect(toggle.focus).toHaveBeenCalledTimes(1)
  })
  it('leaves the focus where it is when it was elsewhere', () => {
    const { sheet, toggle, doc } = setup(false)
    closeSheet(sheet, toggle, doc)
    expect(sheet.hidden).toBe(true)
    expect(toggle.focus).not.toHaveBeenCalled()
  })
})
