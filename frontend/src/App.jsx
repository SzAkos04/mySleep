import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { useStore, syncNow } from './store.js'
import { useUI } from './ui.js'
import { api } from './lib/api.js'
import { Icon } from './components/Icon.jsx'
import { ReviewSheet } from './components/ReviewSheet.jsx'
import { Today } from './views/Today.jsx'
import { Journal } from './views/Journal.jsx'
import { Night } from './views/Night.jsx'
import { Trends } from './views/Trends.jsx'
import { Settings } from './views/Settings.jsx'
import { Login } from './views/Login.jsx'
import { Tracking, startNight } from './views/Tracking.jsx'

const Tab = ({ to, icon, label }) => <NavLink to={to} end><Icon name={icon} />{label}</NavLink>

export function App() {
  const user = useStore(s => s.user), tracking = useStore(s => s.tracking)
  const { sheet, toast, say } = useUI()
  const [signup, setSignup] = useState(false)

  useEffect(() => {
    api('/api/me')
      .then(r => { useStore.getState().setUser(r.user); syncNow() })
      .catch(e => { if (e.status === 401) { useStore.getState().setUser(null); setSignup(!!e.data?.signup) } })   // offline: keep the cached user
  }, [])

  if (!user && !tracking) return <div id="app"><Login signup={signup} /></div>

  return <HashRouter>
    <div id="app">
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/night/:id" element={<Night />} />
        <Route path="/trends" element={<Trends />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
    <div id="tabfade" />
    {/* Sleep is the raised button in the middle, the way Start is in myGym: one tap from any tab */}
    <nav id="tabbar" aria-label="Main">
      <Tab to="/" icon="home" label="Today" />
      <Tab to="/journal" icon="cal" label="Journal" />
      <button className="start" onClick={() => startNight().catch(e => say(e.message, 6000))}><span className="cir"><Icon name="moonfill" /></span><span>Sleep</span></button>
      <Tab to="/trends" icon="chart" label="Trends" />
      <Tab to="/settings" icon="gear" label="Settings" />
    </nav>
    {sheet?.type === 'review' && <ReviewSheet key={sheet.key} night={sheet.night} />}
    {tracking && <Tracking />}
    <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
  </HashRouter>
}
