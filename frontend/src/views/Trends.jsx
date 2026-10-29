import { useState } from 'react'
import { useStore, nightList } from '../store.js'
import { Bars, Windows, scoreColor } from '../components/Charts.jsx'
import { summary, fromNoon, noonToClock } from '../lib/stats.js'
import { dur } from '../lib/time.js'
import { sleepScore, unrecorded, NEED } from '../lib/score.js'

const toNoon = hhmm => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m + 720) % 1440 }

export function Trends() {
  const settings = useStore(s => s.settings), all = nightList(useStore(s => s.nights))
  const [N, setN] = useState(7)
  const L = all.slice(0, N), s = summary(L, NEED), chrono = L.slice().reverse()
  const score = n => sleepScore(n, settings).score
  // averages over the nights the microphone recorded: an empty night says nothing about sleep
  const mean = list => { const r = list.filter(n => !unrecorded(n)); return r.length ? Math.round(r.reduce((t, n) => t + score(n), 0) / r.length) : null }
  const avg = mean(L) ?? 0, prevAvg = mean(all.slice(N, 2 * N))
  return <>
    <header className="hdr"><div><h1>Trends</h1></div></header>
    <div className="seg" style={{ marginBottom: 14 }}>
      {[[7, 'Week'], [30, 'Month'], [365, 'Year']].map(([n, l]) => <button key={n} aria-pressed={N === n} onClick={() => setN(n)}>{l}</button>)}
    </div>
    {!s ? <div className="empty">Trends start after a couple of nights.</div> : <>
      <div className="hero">
        <div className="eyebrow">{N === 7 ? 'This week' : N === 30 ? 'This month' : 'This year'}</div>
        <div className="big num" style={{ fontSize: 44, marginTop: 6 }}>{avg}</div>
        <div className="muted">Average sleep score{prevAvg != null ? ` · ${avg >= prevAvg ? 'up' : 'down'} ${Math.abs(avg - prevAvg)} on the ${N === 7 ? 'week' : N === 30 ? 'month' : 'year'} before` : ''}</div>
        <div className="facts kpis">
          <div><b className="num">{dur(s.avgAsleep)}</b><span>asleep a night</span></div>
          <div><b className="num">{dur(s.debt)}</b><span>short of 8 h, in all</span></div>
          <div><b className="num">{s.on ? noonToClock(s.on.mean) : '–'}</b><span>{s.on ? `asleep ± ${Math.round(s.on.sd)} min` : 'asleep'}</span></div>
          <div><b className="num">{s.wake ? noonToClock(s.wake.mean) : '–'}</b><span>{s.wake ? `awake ± ${Math.round(s.wake.sd)} min` : 'awake'}</span></div>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Score per night</div>
        <Bars nights={chrono} val={score} max={100} ticks={[0, 50, 100]} tick={v => String(v)} color={n => scoreColor(score(n))} h={120} />
      </div>
      <div className="card">
        <div className="eyebrow">Hours asleep</div>
        <div className="card-title" style={{ marginBottom: 10 }}>Against the 8h most adults need</div>
        <Bars nights={chrono} val={n => n.asleepMin} max={540} ticks={[0, 180, 360, 540]} tick={v => v / 60 + 'h'} target={NEED} h={130}
          color={n => n.asleepMin < NEED ? 'color-mix(in srgb,var(--acc) 55%,transparent)' : 'var(--acc)'} />
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
