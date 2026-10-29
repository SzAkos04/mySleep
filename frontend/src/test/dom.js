// Tapping through screens in tests (happy-dom), without a testing library: mount a React tree,
// find things by what a person sees (text, label), click, hold, type. Every step runs in act(), so
// React has re-rendered before the test looks again.
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root = null

export async function mount(el) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(el))
  return host
}
export async function unmount() {
  if (root) await act(async () => root.unmount())
  root = null
  document.body.innerHTML = ''
}

const visible = el => !el.closest('[aria-hidden="true"]')
// The innermost element whose text is exactly `text` (or matches it, for a RegExp).
export function byText(text) {
  const hit = el => text instanceof RegExp ? text.test(el.textContent) : el.textContent.trim() === text
  return [...document.body.querySelectorAll('*')].filter(e => hit(e) && ![...e.children].some(hit) && visible(e)).at(-1) ?? null
}
export const text = () => document.body.textContent.replace(/\s+/g, ' ')
// A button by its words or its accessible name.
export const button = name => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent.trim() === name) ?? null
export const input = label => document.querySelector(`input[aria-label="${label}"]`)

export async function click(el) {
  if (!el) throw new Error('nothing to click')
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}
export async function key(k) {
  await act(async () => { dispatchEvent(new KeyboardEvent('keydown', { key: k })) })
}
// A finger on the element for `ms` (fake timers), then lifted.
export async function hold(el, ms, advance) {
  if (!el) throw new Error('nothing to hold')
  await act(async () => { el.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true })) })
  await act(async () => { advance(ms) })
  await act(async () => { el.dispatchEvent(new Event('touchend', { bubbles: true })) })
}
// Types into a controlled input the way React hears it.
export async function type(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
export const flush = () => act(async () => {})
