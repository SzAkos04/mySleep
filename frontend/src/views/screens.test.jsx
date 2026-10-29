import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useStore, defaultSettings } from '../store.js'
import { summarize } from '../lib/analysis.js'
import { nightIdOf } from '../lib/time.js'
import { Today } from './Today.jsx'
import { Journal } from './Journal.jsx'
import { Trends } from './Trends.jsx'
import { Settings } from './Settings.jsx'
import { Night } from './Night.jsx'
import { Login } from './Login.jsx'
import { alarmPlan } from './Tracking.jsx'

// Every screen as HTML, the way the phone would first draw it: a crash or a missing figure fails
// here, before a build. Taps, animations and the microphone are checked on the iPhone.
const render = (el, path = '/') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>)
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// A night as Tracking's finish() saves it: an 8-hour room, 15 min to fall asleep, one wake-up.
function night(daysAgo = 1, bedHour = 23) {
  const n = 8 * 3600, f = { db: [], low: [], mid: [], vr: [], at: [] }
  for (let s = 0; s < n; s++) {
    const moving = (s < 900 && s % 20 < 2) || (s >= 7200 && s < 7500 && s % 15 < 3)
    f.db.push(moving ? 45 : 30 + (s % 7) / 4); f.low.push(0.3); f.mid.push(0.3); f.vr.push(1); f.at.push(moving ? 2 : 1)
  }
  const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(bedHour, 0, 0, 0)
  const bed = d.getTime(), r = summarize(f, bed)
  return {
    id: nightIdOf(bed), bed, on: r.on, wake: bed + n * 1000, wakes: r.wakes, awakeMin: r.awakeMin, asleepMin: r.asleepMin,
    restfulMin: r.restfulMin, snoreMin: r.snoreMin, talks: r.talks, coughs: r.coughs, events: r.events, timeline: r.timeline,
    clips: [], diag: { events: 40, lockOk: 1, lockFailed: 0, lockReleased: 0, videoOk: 1, videoFailed: 0, micLost: 0, hidden: 0, reloads: 0, stalls: 0, errors: 0 }
  }
}
// rendered to HTML, zustand reads the store's initial state object: seed that one too
const seed = nights => {
  const patch = { user: { id: 'u1', name: 'Test' }, owner: 'u1', settings: defaultSettings(), nights: Object.fromEntries(nights.map(n => [n.id, n])), tracking: null }
  Object.assign(useStore.getInitialState(), patch); useStore.setState(patch)
}

describe('screens', () => {
  beforeEach(() => seed([]))

  it('draw with no nights yet', () => {
    for (const el of [<Today />, <Journal />, <Trends />, <Settings />]) expect(render(el).length).toBeGreaterThan(100)
    expect(text(render(<Login signup />))).toMatch(/mySleep/i)
  })

  it('Today shows last night: score, time asleep, and tonight’s alarm', () => {
    const n = night(); seed([n])
    const t = text(render(<Today />))
    expect(t).toMatch(/Last night/i)
    expect(t).toMatch(/asleep/)
    expect(t).toMatch(/06:15–06:45/)   // smart by default: a window
  })

  it('Journal, Trends and Settings draw a week of nights', () => {
    seed([1, 2, 3, 4, 5, 6, 7].map(d => night(d)))
    expect(render(<Journal />)).toMatch(/<svg|class=/)
    expect(text(render(<Trends />))).toMatch(/\d+h \d+m|\d+ min/)
    expect(render(<Settings />)).toMatch(/value="06:45"/)
  })

  it('a night’s page shows its report and the diagnostics', () => {
    const n = night(); seed([n])
    const t = text(render(<Routes><Route path="/night/:id" element={<Night />} /></Routes>, '/night/' + n.id))
    expect(t).toMatch(/Sleep score/i)
    expect(t).toMatch(/Diagnostics/)
    expect(t).toMatch(/Screen kept on wake lock \+ video/)
    expect(t).toMatch(/Delete night/)
  })
})

describe('alarmPlan', () => {
  const at = (h, m) => { const d = new Date(2026, 9, 28, h, m); return d.getTime() }
  it('rings at the wake time, or from 30 min before it when smart', () => {
    const p = alarmPlan({ ...defaultSettings(), smart: false }, at(23, 0))
    expect(p.from).toBe(p.at)
    expect(new Date(p.at).getHours()).toBe(6)
    const s = alarmPlan(defaultSettings(), at(23, 0))
    expect((s.at - s.from) / 60000).toBe(30)
  })
  it('plans nothing with the alarm off', () => {
    expect(alarmPlan({ ...defaultSettings(), alarm: false }, at(23, 0))).toBeFalsy()
  })
})
