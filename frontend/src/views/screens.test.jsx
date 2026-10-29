import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useStore, defaultSettings } from '../store.js'
import { summarize } from '../lib/analysis.js'
import { nightIdOf } from '../lib/time.js'
import { sleepScore } from '../lib/score.js'
import { Today } from './Today.jsx'
import { Journal } from './Journal.jsx'
import { Trends } from './Trends.jsx'
import { Settings } from './Settings.jsx'
import { Night } from './Night.jsx'
import { Login } from './Login.jsx'
import { Tracking } from './Tracking.jsx'
import * as tracker from '../lib/tracker.js'

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

describe('the night screen', () => {
  const at = (h, m) => new Date(2026, 9, 29, h, m).getTime()
  const tracking = { start: at(0, 30), nightId: '2026-10-28', ringFrom: at(6, 15), ringAt: at(6, 45), smart: true }
  const show = () => {
    useStore.setState({ tracking }); Object.assign(useStore.getInitialState(), { tracking })
    return text(render(<Tracking />))
  }

  it('while listening: the alarm window, what was heard, and a held button to end it', () => {
    Object.assign(tracker.samples, { start: tracking.start, db: [], low: [], mid: [], vr: [], at: [] })
    const t = show()
    expect(t).toMatch(/Alarm 06:15 – 06:45/)
    expect(t).toMatch(/Quiet so far/)
    expect(t).toMatch(/Hold to wake up/)
    expect(t).toMatch(/Dims in 30 s/)
  })

  it('after the page was closed in the night: when it stopped, Resume, and finish without listening', () => {
    Object.assign(tracker.samples, { start: 0 })
    localStorage.setItem('mysleep_track', JSON.stringify({ start: tracking.start, db: Array(600).fill(40), low: [], mid: [], vr: [], at: [] }))
    const t = show()
    expect(t).toMatch(/Stopped listening at 00:40/)
    expect(t).toMatch(/Resume listening/)
    expect(t).toMatch(/Hold to finish the night/)
  })
})

describe('a night the microphone did not record (29 October)', () => {
  const blank = d => { const n = night(d); return { ...n, on: null, asleepMin: 0, restfulMin: 0, wakes: 0, events: [], timeline: { ...n.timeline, states: 'g'.repeat(n.timeline.states.length) } } }
  const scoreOf = n => sleepScore(n, defaultSettings()).score

  it('its page says nothing was recorded, not that it was a rough night, and compares it with nothing', () => {
    const n = blank(1); seed([n, night(2), night(3), night(4)])
    const t = text(render(<Routes><Route path="/night/:id" element={<Night />} /></Routes>, '/night/' + n.id))
    expect(t).toMatch(/Nothing recorded/)
    expect(t).not.toMatch(/rough night/)
    expect(t).not.toMatch(/your week/)
    expect(t).toMatch(/The microphone recorded nothing \(8h 00m\), so this night has no score/)
    expect(t).not.toMatch(/Microphone sent nothing/)   // a night from before silence was counted
    const logged = { ...n, diag: { ...n.diag, micSilent: 2, recoveries: 6, recovered: 0 } }; seed([logged])
    const t2 = text(render(<Routes><Route path="/night/:id" element={<Night />} /></Routes>, '/night/' + n.id))
    expect(t2).toMatch(/Microphone sent nothing 2/)
    expect(t2).toMatch(/Ways back tried 6 · worked 0/)
  })

  it('Today: the last night says nothing was recorded, and the week average leaves it out', () => {
    const good = [night(2), night(3)]
    seed([blank(1), ...good])
    const t = text(render(<Today />))
    expect(t).toMatch(/Nothing recorded/)
    expect(t).toMatch(new RegExp(`Average ${Math.round((scoreOf(good[0]) + scoreOf(good[1])) / 2)}\\b`))
  })

  it('does not pull down the averages: a recorded night, Journal and Trends', () => {
    const good = [night(2), night(3), night(4)], last = night(5)
    seed([blank(1), ...good, last])
    const t = text(render(<Routes><Route path="/night/:id" element={<Night />} /></Routes>, '/night/' + good[0].id))
    expect(t).toMatch(new RegExp(`your week \\(${scoreOf(good[1])}\\)`))   // the other recorded nights only
    expect(text(render(<Journal />))).toMatch(new RegExp(`Average ${scoreOf(good[0])} ·`))
    expect(text(render(<Trends />))).toMatch(new RegExp(`\\b${scoreOf(good[0])}\\b`))
  })
})
