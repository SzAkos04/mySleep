import { it, expect } from 'vitest'
import { summary, noonToClock } from './stats.js'

const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime()

it('averages bedtimes across midnight and sums only the shortfall as debt', () => {
  const s = summary([
    { on: at(20, 23, 50), wake: at(21, 6, 40), asleepMin: 400 },
    { on: at(21, 0, 10), wake: at(22, 6, 50), asleepMin: 480 }
  ], 450)
  expect(noonToClock(s.on.mean)).toBe('00:00')
  expect(s.on.sd).toBe(10)
  expect(noonToClock(s.wake.mean)).toBe('06:45')
  expect(s.debt).toBe(50)
  expect(s.avgAsleep).toBe(440)
})

it('has nothing to say without nights', () => {
  expect(summary([], 450)).toBe(null)
})
