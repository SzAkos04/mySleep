import { useState } from 'react'
import { useStore, nightList } from '../store.js'
import { Bars, Windows } from '../components/Charts.jsx'
import { summary, fromNoon, noonToClock } from '../lib/stats.js'
import { dur } from '../lib/time.js'
import { sleepScore } from '../lib/score.js'

const toNoon = hhmm => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m + 720) % 1440 }

export function Trends() {
  const settings = useStore(s => s.settings), all = nightList(useStore(s => s.nights))
  const [N, setN] = useState(7)
  const L = all.slice(0, N), s = summary(L, settings.need), chrono = L.slice().reverse()
  return <>
    <header className="hdr"><div><h1>Trends</h1><div className="sub">Last {N} nights</div></div></header>
    <div className="seg" style={{ marginBottom: 14 }}>
      {[7, 30].map(n => <button key={n} aria-pressed={N === n} onClick={() => setN(n)}>{n} nights</button>)}
    </div>
    {!s ? <div className="empty">Trends start after a couple of nights.</div> : <>
      <div className="tiles">
        <div className="tile"><div className="l">Avg sleep score</div><div className="v">{Math.round(L.reduce((t, n) => t + sleepScore(n, settings).score, 0) / L.length)}</div><div className="d">out of 100</div></div>
        <div className="tile"><div className="l">Restful</div><div className="v">{dur(L.reduce((t, n) => t + (n.restfulMin || 0), 0) / L.length)}</div><div className="d">a night, estimate</div></div>
        <div className="tile"><div className="l">Avg asleep</div><div className="v">{dur(s.avgAsleep)}</div><div className="d">need {dur(settings.need)}</div></div>
        <div className="tile"><div className="l">Sleep debt</div><div className="v">{dur(s.debt)}</div><div className="d">over {s.n} nights</div></div>
        <div className="tile"><div className="l">Fell asleep</div><div className="v">{s.on ? noonToClock(s.on.mean) : '–'}</div>{s.on && <div className="d">± {Math.round(s.on.sd)} min</div>}</div>
        <div className="tile"><div className="l">Woke up</div><div className="v">{s.wake ? noonToClock(s.wake.mean) : '–'}</div>{s.wake && <div className="d">± {Math.round(s.wake.sd)} min</div>}</div>
      </div>
      <div className="card">
        <div className="eyebrow">Hours asleep</div>
        <div className="card-title" style={{ marginBottom: 10 }}>Against a {dur(settings.need)} need</div>
        <Bars nights={chrono} val={n => n.asleepMin} max={540} ticks={[0, 180, 360, 540]} tick={v => v / 60 + 'h'} target={settings.need} h={130}
          color={n => n.asleepMin < settings.need ? 'color-mix(in srgb,var(--acc) 55%,transparent)' : 'var(--acc)'} />
      </div>
      <div className="card">
        <div className="eyebrow">Consistency</div>
        <div className="card-title" style={{ marginBottom: 10 }}>When you slept</div>
        <Windows nights={chrono} bedtime={toNoon(settings.bedtime)} wake={toNoon(settings.wake)} fromNoon={fromNoon} />
        <div className="legend"><span><i style={{ background: 'var(--acc)' }} />Asleep</span><span><i style={{ boxShadow: 'inset 0 0 0 1.5px var(--label-2)' }} />Target {settings.bedtime}–{settings.wake}</span></div>
      </div>
      {chrono.some(n => n.snoreMin) && <div className="card">
        <div className="eyebrow">Snoring</div>
        <div className="card-title" style={{ marginBottom: 10 }}>Minutes per night</div>
        <Bars nights={chrono} val={n => n.snoreMin} max={Math.max(20, ...chrono.map(n => n.snoreMin || 0))} ticks={[0]} tick={() => '0'} color={() => 'var(--snore)'} h={90} />
      </div>}
    </>}
  </>
}
