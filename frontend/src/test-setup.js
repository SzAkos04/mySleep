// The little of a page that modules touch when they load (vitest runs in Node): events on
// document and window, localStorage, matchMedia. Each test starts with empty storage.
import { beforeEach } from 'vitest'

const store = new Map()
const page = new EventTarget()
Object.assign(globalThis, {
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() },
  document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  addEventListener: page.addEventListener.bind(page), removeEventListener: page.removeEventListener.bind(page), dispatchEvent: page.dispatchEvent.bind(page),
  screen: { width: 414, height: 896 }, devicePixelRatio: 3,
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
})
globalThis.window = globalThis

beforeEach(() => store.clear())
