// The little of a page that modules touch when they load, for tests that run in plain Node:
// events on document and window, localStorage, matchMedia. Tests that tap through screens run in
// happy-dom (`// @vitest-environment happy-dom`), which has a real page; this leaves that one alone.
// Each test starts with empty storage.
import { beforeEach } from 'vitest'
import { setMaxListeners } from 'node:events'

if (typeof localStorage === 'undefined' || !globalThis.localStorage) {
  const store = new Map()
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() }
}
if (typeof document === 'undefined') {
  const page = new EventTarget()
  Object.assign(globalThis, {
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    addEventListener: page.addEventListener.bind(page), removeEventListener: page.removeEventListener.bind(page), dispatchEvent: page.dispatchEvent.bind(page),
    screen: { width: 414, height: 896 }, devicePixelRatio: 3,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  })
  globalThis.window = globalThis
  // modules loaded fresh in each test (tracker.test.js) each add their page listeners
  setMaxListeners(200, document, page)
}

beforeEach(() => localStorage.clear())
