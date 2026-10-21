import { useStore, nightList } from '../store.js'
import { Timeline, ScoreRing } from './Charts.jsx'
import { sleepScore, insights } from '../lib/score.js'
import { dur } from '../lib/time.js'

export const verdict = s => s >= 85 ? 'A great night' : s >= 70 ? 'A good night' : s >= 55 ? 'An okay night' : 'A rough night'

// A night at a glance: the score and what it means, three numbers, the night as a picture.
// The morning screen, the top of Today in the morning, and the night's own page.
export function NightReport({ n, label = 'Sleep score' }) {
  const settings = useStore(s => s.settings), nights = nightList(useStore(s => s.nights))
  const score = sleepScore(n, settings).score
  const week = nights.filter(x => x.id !== n.id).slice(0, 7)
  const avg = week.length >= 3 ? Math.round(week.reduce((s, x) => s + sleepScore(x, settings).score, 0) / week.length) : null
  const latency = n.on ? Math.round((n.on - n.bed) / 60000) : null
  return <div className="hero">
    <div className="score">
      <ScoreRing score={score} size={88} />
      <div>
        <div className="eyebrow">{label}</div>
        <div className="report-title">{verdict(score)}</div>
        {avg != null && <div className="small muted">{score > avg ? 'Better than' : score < avg ? 'Below' : 'Same as'} your week ({avg})</div>}
      </div>
    </div>
    <div className="facts">
      <div><b className="num">{dur(n.asleepMin || 0)}</b><span>asleep</span></div>
      <div><b className="num">{latency != null ? latency + ' min' : '–'}</b><span>to fall asleep</span></div>
      <div><b className="num">{n.restfulMin != null ? dur(n.restfulMin) : '–'}</b><span>restful</span></div>
    </div>
    {n.timeline && <div style={{ marginTop: 12 }}><Timeline t={n.timeline} /></div>}
  </div>
}

export function Insights({ n, max }) {
  const lines = insights(n).slice(0, max)
  if (!lines.length) return null
  return <div className="card"><ul className="insights">{lines.map(l => <li key={l}>{l}</li>)}</ul></div>
}
