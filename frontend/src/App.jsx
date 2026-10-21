import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { useStore, syncNow } from './store.js'
import { useUI } from './ui.js'
import { api } from './lib/api.js'
import { Icon } from './components/Icon.jsx'
import { ReviewSheet } from './components/ReviewSheet.jsx'
import { PreviewSheet } from './components/PreviewSheet.jsx'
import { Tonight } from './views/Tonight.jsx'
import { History } from './views/History.jsx'
import { Night } from './views/Night.jsx'
import { Trends } from './views/Trends.jsx'
import { Settings } from './views/Settings.jsx'
import { Login } from './views/Login.jsx'
import { Tracking } from './views/Tracking.jsx'

const TABS = [['/', 'moon', 'Tonight'], ['/history', 'list', 'History'], ['/trends', 'chart', 'Trends'], ['/settings', 'gear', 'Settings']]

export function App() {
  const user = useStore(s => s.user), tracking = useStore(s => s.tracking)
  const { sheet, toast } = useUI()
  const [signup, setSignup] = useState(false)
  // keep the last sheet's content while it slides away
  const [shownSheet, setShownSheet] = useState(sheet)
  useEffect(() => { if (sheet) setShownSheet(sheet) }, [sheet])

  useEffect(() => {
    api('/api/me')
      .then(r => { useStore.getState().setUser(r.user); syncNow() })
      .catch(e => { if (e.status === 401) { useStore.getState().setUser(null); setSignup(!!e.data?.signup) } })   // offline: keep the cached user
  }, [])

  if (!user && !tracking) return <div id="app"><Login signup={signup} /></div>

  return <HashRouter>
    <div id="app">
      <Routes>
        <Route path="/" element={<Tonight />} />
        <Route path="/history" element={<History />} />
        <Route path="/night/:id" element={<Night />} />
        <Route path="/trends" element={<Trends />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
    <nav id="tabbar" aria-label="Main">
      {TABS.map(([to, icon, label]) => <NavLink key={to} to={to} end><Icon name={icon} />{label}</NavLink>)}
    </nav>
    {shownSheet?.type === 'review' && <ReviewSheet key={shownSheet.night.id || 'new'} night={shownSheet.night} open={sheet?.type === 'review'} />}
    {shownSheet?.type === 'preview' && <PreviewSheet open={sheet?.type === 'preview'} />}
    {tracking && <Tracking />}
    <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
  </HashRouter>
}
