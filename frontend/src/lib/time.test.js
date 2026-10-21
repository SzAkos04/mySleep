import { it, expect } from 'vitest'
import { nightIdOf, atClock, nextAt } from './time.js'

it('names a night after its evening and places clock times on the right day', () => {
  expect(nightIdOf(new Date(2026, 9, 21, 2, 30).getTime())).toBe('2026-10-20')
  expect(nightIdOf(new Date(2026, 9, 20, 23, 30).getTime())).toBe('2026-10-20')
  expect(atClock('2026-10-20', '23:12')).toBe(new Date(2026, 9, 20, 23, 12).getTime())
  expect(atClock('2026-10-20', '06:48')).toBe(new Date(2026, 9, 21, 6, 48).getTime())
  // month end
  expect(atClock('2026-10-31', '07:00')).toBe(new Date(2026, 10, 1, 7, 0).getTime())
})

it('finds the next wake time after now', () => {
  const eve = new Date(2026, 9, 20, 23, 0).getTime()
  expect(nextAt('06:45', eve)).toBe(new Date(2026, 9, 21, 6, 45).getTime())
  expect(nextAt('23:30', eve)).toBe(new Date(2026, 9, 20, 23, 30).getTime())
})
