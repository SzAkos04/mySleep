import { describe, it, expect } from 'vitest'
import { sleepScore, insights, unrecorded } from './score.js'

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

it('snoring through the night: says the hour with the most of it', () => {
  const start = at(20, 23, 0)
  const n = { bed: start, on: start + 600000, snoreMin: 30, timeline: { start, states: 'l'.repeat(600) },
    events: [{ t: at(21, 1, 10), kind: 'snore', sec: 300 }, { t: at(21, 3, 5), kind: 'snore', sec: 900 }, { t: at(21, 3, 40), kind: 'snore', sec: 600 }, { t: at(21, 23, 30), kind: 'snore', sec: 100 }] }
  expect(insights(n).join(' ')).toContain('You snored for about 30 min, mostly between 03:00 and 04:00.')
})

describe('a night the microphone did not record', () => {
  const start = at(28, 1, 31)
  const blank = { bed: start, wake: start + 37276000, on: null, asleepMin: 0, timeline: { start, states: 'g'.repeat(1242) + 'w' } }

  it('is told apart from a night without sleep', () => {
    expect(unrecorded(blank)).toBe(true)
    expect(unrecorded({ ...blank, timeline: { start, states: 'w'.repeat(1243) } })).toBe(false)
    expect(unrecorded({ bed: 0, wake: 1 })).toBe(false)   // nights from before timelines
  })

  it('says the microphone recorded nothing, not that you were moving', () => {
    const text = insights(blank)
    expect(text).toEqual(['The microphone recorded nothing (10h 21m), so this night has no score.'])
    expect(text.join(' ')).not.toMatch(/moving/)
    // the last half-minute block is padded: never more than the time in bed (10h 21m 16s here)
    expect(insights({ ...blank, timeline: { start, states: 'g'.repeat(1243) } })[0]).toMatch(/\(10h 21m\)/)
  })

  it('names the stretches it missed in a recorded night', () => {
    const states = 'w'.repeat(30) + 'l'.repeat(60) + 'g'.repeat(60) + 'l'.repeat(200) + 'g'.repeat(10) + 'l'.repeat(100)
    const n = { bed: start, wake: start + states.length * 30000, on: start + 15 * 60000, asleepMin: 180, timeline: { start, states } }
    expect(insights(n)).toContain('The microphone recorded nothing for 35 min in 2 stretches, the longest from 02:16.')
    const one = { ...n, timeline: { start, states: 'l'.repeat(100) + 'g'.repeat(30) + 'l'.repeat(100) } }
    expect(insights(one)).toContain('The microphone recorded nothing for 15 min, from 02:21.')
    const brief = { ...n, timeline: { start, states: 'l'.repeat(100) + 'g'.repeat(10) + 'l'.repeat(100) } }
    expect(insights(brief).join(' ')).not.toMatch(/recorded nothing/)   // 5 min: not worth a line
  })
})
