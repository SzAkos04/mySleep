import { describe, it, expect } from 'vitest'
import { reportView, journalView, trendsView, verdict } from './views.js'
import { sleepScore } from './score.js'
import { atClock } from './time.js'

// What mySleep Night's screens show, as plain data (the app draws it): the night's report, the
// journal's month, the trends. The wording and the numbers are the web app's own.
const settings = { bedtime: '23:00', wake: '06:45', alarm: true, smart: true }
const night = (id, asleepMin = 450, extra = {}) => {
  const bed = atClock(id, '23:00')
  return { id, bed, on: bed + 15 * 60e3, wake: atClock(id, '07:00'), asleepMin, awakeMin: 5, wakes: 1, restfulMin: 200, snoreMin: 0, talks: 0, coughs: 0, events: [], ...extra }
}
const state = (...ns) => ({ settings, nights: Object.fromEntries(ns.map(n => [n.id, n])) })
const NOW = new Date(2026, 9, 29, 9, 0).getTime()

describe('verdict', () => {
  it('names a night by its score', () => {
    expect([90, 85, 84, 70, 69, 55, 54, 0].map(verdict)).toEqual(['A great night', 'A great night', 'A good night', 'A good night', 'An okay night', 'An okay night', 'A rough night', 'A rough night'])
  })
})

describe('reportView: a night at a glance', () => {
  it('the title, the times, the score and what it means, three numbers', () => {
    const n = night('2026-10-28'), v = reportView(state(n), '2026-10-28')
    expect(v.title).toBe('Wed, Oct 28')
    expect(v.range).toBe('In bed 23:00 – 07:00 · 8h 00m')
    expect(v.score).toBe(sleepScore(n, settings).score)
    expect(v.verdict).toBe(verdict(v.score))
    expect(v.blank).toBe(false)
    expect(v.facts).toEqual([{ value: '7h 30m', label: 'asleep' }, { value: '15 min', label: 'to fall asleep' }, { value: '3h 20m', label: 'restful' }])
  })
  it('compared with the week before, when there are three nights to compare with', () => {
    const week = ['21', '22', '23', '24', '25'].map(d => night('2026-10-' + d, 400))
    const good = night('2026-10-28', 480)
    const v = reportView(state(...week, good), '2026-10-28')
    const avg = Math.round(week.reduce((t, n) => t + sleepScore(n, settings).score, 0) / week.length)
    expect(v.vsWeek).toBe(`Better than your week (${avg})`)
    expect(reportView(state(week[0], good), '2026-10-28').vsWeek).toBeNull()
  })
  it('a night the microphone did not record says so, with no score to compare', () => {
    const n = night('2026-10-28', 0, { on: null, timeline: { start: 1, db: [], events: '', states: 'g'.repeat(100) } })
    const v = reportView(state(n), '2026-10-28')
    expect(v.blank).toBe(true)
    expect(v.verdict).toBe('Nothing recorded')
    expect(v.vsWeek).toBeNull()
    expect(v.insights[0]).toMatch(/recorded nothing/)
  })
  it('how the score adds up, the sentences, the sounds, the alarm and the app’s diagnostics', () => {
    const n = night('2026-10-28', 450, {
      events: [{ kind: 'snore', t: atClock('2026-10-28', '02:10'), sec: 300 }, { kind: 'talk', t: atClock('2026-10-28', '03:00'), sec: 20 }], snoreMin: 5,
      alarm: { at: atClock('2026-10-28', '06:33'), early: 12 }, diag: { app: 'native', interruptions: 1, restarts: 0, micSilent: 0, locked: 2 }
    })
    const v = reportView(state(n), '2026-10-28')
    expect(v.parts.map(p => p.label)).toEqual(sleepScore(n, settings).parts.map(p => p.label))
    expect(v.parts[0]).toEqual({ label: 'Duration', note: '7h 30m of 8h 00m', pts: sleepScore(n, settings).parts[0].pts, max: 35 })
    expect(v.insights.some(l => /snored for about 5 min/.test(l))).toBe(true)
    expect(v.sounds).toEqual([{ label: 'Snoring', time: '02:10', length: '5 min' }, { label: 'Talking', time: '03:00', length: '20 s' }])
    expect(v.alarm).toBe('The alarm rang at 06:33, 12 min early.')
    expect(v.diag).toEqual([
      { label: 'Recorded by', value: 'mySleep Night', bad: false }, { label: 'Interruptions', value: '1', bad: true },
      { label: 'Audio restarted', value: '0', bad: false }, { label: 'Microphone sent nothing', value: '0', bad: false }, { label: 'Phone locked', value: '2', bad: false }
    ])
  })
  it('a night that is not there, or deleted, is nothing', () => {
    expect(reportView(state(), '2026-10-28')).toBeNull()
    expect(reportView(state({ id: '2026-10-28', deleted: true, ts: 1 }), '2026-10-28')).toBeNull()
  })
})

describe('journalView: a month of nights', () => {
  const ns = [night('2026-10-27', 480), night('2026-10-28', 300), night('2026-10-20', 0, { on: null, timeline: { start: 1, db: [], events: '', states: 'g'.repeat(100) } }), night('2026-09-30', 450)]
  it('the month as a calendar from Monday: blank days before, each day a night, nothing, blank or scored', () => {
    const v = journalView(state(...ns), { year: 2026, month: 9 }, null, NOW)
    expect(v.title).toBe('October')
    expect(v.sub).toBe('Average ' + Math.round((sleepScore(ns[0], settings).score + sleepScore(ns[1], settings).score) / 2) + ' · 3 nights')
    expect(v.lead).toBe(3)   // 1 October 2026 is a Thursday
    expect(v.days).toHaveLength(31)
    expect(v.days[26]).toMatchObject({ n: 27, id: '2026-10-27', kind: 'scored', score: sleepScore(ns[0], settings).score })
    expect(v.days[19].kind).toBe('blank')
    expect(v.days[0].kind).toBe('none')
    expect(v.days[29].kind).toBe('future')    // 30 October, after NOW
    expect(v.canNext).toBe(false)
  })
  it('an earlier month: its own year when not this one, a way forward, "No nights" when empty', () => {
    expect(journalView(state(...ns), { year: 2026, month: 8 }, null, NOW)).toMatchObject({ title: 'September', canNext: true, lead: 1 })
    const empty = journalView(state(...ns), { year: 2025, month: 11 }, null, NOW)
    expect(empty).toMatchObject({ title: 'December 2025', sub: 'No nights this month' })
  })
  it('the chosen night below (last night at first): its numbers in a line', () => {
    const v = journalView(state(...ns), { year: 2026, month: 9 }, null, NOW)
    expect(v.selected).toMatchObject({ id: '2026-10-28', title: 'Wed, Oct 28', headline: '5h 00m asleep', line: 'Woke once' })
    expect(journalView(state(...ns), { year: 2026, month: 9 }, '2026-10-27', NOW).selected.id).toBe('2026-10-27')
    expect(journalView(state(), { year: 2026, month: 9 }, null, NOW).selected).toBeNull()
    expect(journalView(state(), { year: 2026, month: 9 }, null, NOW).empty).toBe('Your nights will fill this calendar.')
  })
})

describe('trendsView', () => {
  const week = ['22', '23', '24', '25', '26', '27', '28'].map((d, i) => night('2026-10-' + d, 420 + i * 10, i === 3 ? { snoreMin: 12 } : {}))
  it('nothing to show before a couple of nights', () => {
    expect(trendsView(state(), 7)).toEqual({ empty: 'Trends start after a couple of nights.' })
  })
  it('a week: the average and four numbers, then a bar for each night', () => {
    const v = trendsView(state(...week), 7)
    const sc = week.map(n => sleepScore(n, settings).score)
    expect(v.label).toBe('This week')
    expect(v.avg).toBe(Math.round(sc.reduce((a, b) => a + b) / 7))
    expect(v.change).toBeNull()
    expect(v.kpis.map(k => k.label)).toEqual(['asleep a night', 'short of 8 h, in all', 'asleep ± 0 min', 'awake ± 0 min'])
    expect(v.kpis[0].value).toBe('7h 30m')
    expect(v.scores.map(s => s.value)).toEqual(sc)                       // oldest first
    expect(v.scores[0]).toMatchObject({ id: '2026-10-22', label: 'T' })   // 22 October 2026 is a Thursday
    expect(v.hours.map(h => h.value)).toEqual([420, 430, 440, 450, 460, 470, 480])
    expect(v.hours[6].full).toBe(true)
    expect(v.hours[0].full).toBe(false)
    expect(v.windows[0]).toMatchObject({ id: '2026-10-22' })
    expect(v.target).toEqual({ bed: 660, wake: 1125, label: '23:00–06:45' })   // minutes after noon
    expect(v.snoring).toEqual(week.map(n => ({ id: n.id, label: expect.any(String), value: n.snoreMin || 0 })))
  })
  it('compared with the period before, when there is one; none of the snoring chart without snoring', () => {
    const before = ['15', '16', '17', '18', '19', '20', '21'].map(d => night('2026-10-' + d, 300))
    const v = trendsView(state(...before, ...week.map(n => ({ ...n, snoreMin: 0 }))), 7)
    expect(v.change).toMatch(/^up \d+ on the week before$/)
    expect(v.snoring).toBeNull()
  })
  it('a month labels the Mondays with their date', () => {
    const many = Array.from({ length: 14 }, (_, i) => night('2026-10-' + String(15 + i).padStart(2, '0'), 450))
    const v = trendsView(state(...many), 30)
    expect(v.label).toBe('This month')
    expect(v.scores.filter(s => s.label).map(s => s.label)).toEqual(['19', '26'])   // the Mondays
  })
})
