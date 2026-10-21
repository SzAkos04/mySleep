import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(<App />)

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
