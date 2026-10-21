/* mySleep service worker: the app shell offline, and the bedtime / backup alarm pushes.
   CACHE carries the build hash (vite.config.js), so a deploy is a new worker with a new cache. */
const CACHE = 'mysleep-__BUILD__'

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    const res = await fetch('index.html', { cache: 'no-cache' })
    if (!res.ok) throw new Error('precache: ' + res.status)
    const html = await res.clone().text()
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:)?\/\//.test(u))
    await c.put('index.html', res)
    await c.addAll(refs)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

// The API never comes from the cache. Everything else: network first, cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request)
      if (res.ok && url.pathname.startsWith('/assets/')) (await caches.open(CACHE)).put(e.request, res.clone())
      return res
    } catch {
      return (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())
    }
  })())
})

self.addEventListener('push', e => {
  const p = e.data ? e.data.json() : { title: 'mySleep' }
  e.waitUntil(self.registration.showNotification(p.title, { body: p.body, tag: p.tag, icon: 'icon-180.png', requireInteraction: p.tag === 'alarm' }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (all[0]) return all[0].focus()
    return self.clients.openWindow('./')
  })())
})
