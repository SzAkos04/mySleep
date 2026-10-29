import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { useStore, syncNow } from './store.js'
import { useUI } from './ui.js'
import { api } from './lib/api.js'
import { importNative, sleepLink } from './lib/native.js'
import { Icon } from './components/Icon.jsx'
import { ReviewSheet } from './components/ReviewSheet.jsx'
import { Today } from './views/Today.jsx'
import { Journal } from './views/Journal.jsx'
import { Night } from './views/Night.jsx'
import { Trends } from './views/Trends.jsx'
import { Settings } from './views/Settings.jsx'
import { Login } from './views/Login.jsx'

const Tab = ({ to, icon, label }) => <NavLink to={to} end><Icon name={icon} />{label}</NavLink>

// The nights mySleep Night uploaded, turned into this app's nights (lib/native.js).
const takeInNights = () => importNative({ get: path => api(path), nights: useStore.getState().nights, save: n => useStore.getState().saveNight(n) }).catch(() => {})

export function App() {
  const user = useStore(s => s.user), settings = useStore(s => s.settings)
  const { sheet, toast } = useUI()
  const [signup, setSignup] = useState(false)

  useEffect(() => {
    api('/api/me')
      .then(r => { useStore.getState().setUser(r.user); useUI.setState({ devices: r.devices || [] }); syncNow(); takeInNights() })
      .catch(e => {
        if (e.status === 401) { useStore.getState().setUser(null); setSignup(!!e.data?.signup) }
        else syncNow()   // offline: keep the cached user, and let the server check in the corner say so
      })
  }, [])
  // back from mySleep Night in the morning: its night is on the server by now
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && useStore.getState().user && takeInNights()
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])

  if (!user) return <div id="app"><Login signup={signup} /></div>

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
      {/* the night is mySleep Night's (ios/): it records with the phone locked, which a web app cannot */}
      <a className="start" href={sleepLink(settings)}><span className="cir"><Icon name="moonfill" /></span><span>Sleep</span></a>
      <Tab to="/trends" icon="chart" label="Trends" />
      <Tab to="/settings" icon="gear" label="Settings" />
    </nav>
    {sheet?.type === 'review' && <ReviewSheet key={sheet.key} night={sheet.night} />}
    <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
  </HashRouter>
}
