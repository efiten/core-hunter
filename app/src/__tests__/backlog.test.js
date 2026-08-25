import { describe, it, expect } from 'vitest'
import { backlogState, BACKLOG_NOTICE_MIN, BACKLOG_ALARM } from '../backlog.js'

describe('backlogState', () => {
  it('says nothing while the drain is just doing its job', () => {
    // A burst between two 5 s ticks is queued and gone again before anyone
    // could read it. A line that appears every few seconds trains people to
    // ignore the line that matters.
    expect(backlogState(0).show).toBe(false)
    expect(backlogState(24).show).toBe(false)
  })

  it('speaks up once the backlog is more than a hiccup', () => {
    // Absolute numbers, not arithmetic on the constants: a fixture written as
    // BACKLOG_NOTICE_MIN - 1 moves with the threshold and stops binding it.
    expect(backlogState(24).show).toBe(false)
    expect(backlogState(25).show).toBe(true)
    expect(backlogState(25).level).toBe('warn')
  })

  it('escalates when the backlog is minutes of catching up', () => {
    expect(backlogState(249).level).toBe('warn')
    expect(backlogState(250).level).toBe('alarm')
    // The night this is about: 3,005 receptions more than ten minutes late.
    expect(backlogState(3005)).toMatchObject({ show: true, level: 'alarm' })
    expect(backlogState(3005).text).toContain('3,005')
  })

  it('keeps the thresholds where the reasoning put them', () => {
    expect(BACKLOG_NOTICE_MIN).toBe(25)
    expect(BACKLOG_ALARM).toBe(250)
  })

  it('shows any backlog at all while disconnected, however small', () => {
    // Disconnected is the state where a small number does not shrink on its
    // own, so the "it will clear itself" reasoning does not apply.
    expect(backlogState(3, { connected: false })).toMatchObject({ show: true })
    expect(backlogState(3, { connected: false }).text).toContain('not connected')
    // ...but nothing waiting is nothing to say, connected or not.
    expect(backlogState(0, { connected: false }).show).toBe(false)
  })

  it('states a pause rather than warning about it, and still shows the number', () => {
    // The hunter chose this. But "I paused it" and "I paused it and 4,000
    // receptions are waiting" are different situations.
    const s = backlogState(4000, { paused: true, connected: false })
    expect(s.show, 'a paused drain with a backlog still has to show it').toBe(true)
    expect(s.level).toBe('paused')
    expect(s.text).toContain('paused')
    expect(s.text).toContain('4,000')
  })

  it('answers for input the render tick can actually hand it', () => {
    for (const bad of [null, undefined, NaN, -5, 'nope']) {
      expect(backlogState(bad).pending, String(bad)).toBe(0)
      expect(backlogState(bad).show).toBe(false)
    }
    expect(backlogState(30.7).pending).toBe(30)
  })
})
