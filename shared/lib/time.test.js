import { describe, it, expect } from 'vitest'
import { nightIdOf, atClock, dur } from './time.js'

it('names a night after its evening and places clock times on the right day', () => {
  expect(nightIdOf(new Date(2026, 9, 21, 2, 30).getTime())).toBe('2026-10-20')
  expect(nightIdOf(new Date(2026, 9, 20, 23, 30).getTime())).toBe('2026-10-20')
  expect(atClock('2026-10-20', '23:12')).toBe(new Date(2026, 9, 20, 23, 12).getTime())
  expect(atClock('2026-10-20', '06:48')).toBe(new Date(2026, 9, 21, 6, 48).getTime())
  // month end
  expect(atClock('2026-10-31', '07:00')).toBe(new Date(2026, 10, 1, 7, 0).getTime())
})

describe('dur', () => {
  it('rolls minutes over into the hour instead of printing 60m', () => {
    expect(dur(119.6)).toBe('2h 00m')
    expect(dur(59.5)).toBe('1h 00m')
    expect(dur(179.5)).toBe('3h 00m')
    expect(dur(59.4)).toBe('59 min')
    expect(dur(125)).toBe('2h 05m')
  })
})
