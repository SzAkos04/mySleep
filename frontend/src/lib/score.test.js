import { it, expect } from 'vitest'
import { sleepScore, insights } from './score.js'

const settings = { bedtime: '23:00' }
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime()

it('gives a full night full marks and scales a short, broken one down', () => {
  const good = { bed: at(20, 22, 50), on: at(20, 23, 0), wake: at(21, 7, 15), asleepMin: 490, awakeMin: 0, wakes: 0, restfulMin: 170, timeline: { states: '' } }
  expect(sleepScore(good, settings).score).toBe(100)

  const bad = { bed: at(20, 23, 0), on: at(21, 0, 30), wake: at(21, 5, 30), asleepMin: 240, awakeMin: 40, wakes: 3, restfulMin: 0, timeline: { states: '' } }
  const s = sleepScore(bad, settings)
  expect(s.score).toBeLessThan(40)
  expect(s.parts.map(p => p.label)).toEqual(['Duration', 'Efficiency', 'Continuity', 'Falling asleep', 'Restfulness', 'Routine'])
})

it('gives a night without sleep nothing for continuity, falling asleep or routine', () => {
  const none = { bed: at(21, 21, 55), on: at(21, 21, 55), wake: at(21, 21, 57), asleepMin: 0, awakeMin: 0, wakes: 0, restfulMin: 0, timeline: { states: 'wwww' } }
  expect(sleepScore(none, settings).score).toBe(0)
  expect(insights({ ...none, on: null })).toEqual(['No sleep was heard: you were moving, or the recording was too short.'])
})

it('scores a night typed in by hand on the parts it has', () => {
  const manual = { bed: at(20, 23, 0), on: at(20, 23, 0), wake: at(21, 7, 0), asleepMin: 480 }
  const s = sleepScore(manual, settings)
  expect(s.parts.map(p => p.label)).not.toContain('Restfulness')
  expect(s.score).toBe(100)
})

it('says what happened in the night', () => {
  const start = at(20, 23, 0)
  const states = 'w'.repeat(30) + 'l'.repeat(60) + 'w'.repeat(6) + 'd'.repeat(80) + 'l'.repeat(40)
  const n = {
    bed: start, on: start + 15 * 60000, wakes: 1, awakeMin: 3, snoreMin: 12,
    events: [{ t: at(21, 2, 10), kind: 'snore', sec: 700 }, { t: at(21, 3, 5), kind: 'talk', sec: 6 }, { t: at(21, 4, 0), kind: 'cough', sec: 1 }],
    timeline: { start, states }
  }
  const text = insights(n).join(' ')
  expect(text).toContain('You fell asleep at 23:15, 15 min after going to bed.')
  expect(text).toContain('You woke once (23:45)')
  expect(text).toContain('You snored for about 12 min, from 02:10.')
  expect(text).toContain('You talked in your sleep once (03:05).')
  expect(text).toContain('You coughed once (04:00).')
  expect(text).toContain('Your most restful stretch was 23:48–00:28 (estimate).')
})
