import { it, expect } from 'vitest'
import { pendingChanges, mergeRemote, stillDirty } from './sync.js'

const state = () => ({
  nights: { a: { id: 'a', q: 3, ts: 200 }, b: { id: 'b', deleted: true, ts: 300 } },
  settings: { bedtime: '23:00', ts: 0 },
  dirty: { 'night:a': true, 'night:b': true }
})

it('sends edited nights and deletions', () => {
  expect(pendingChanges(state())).toEqual([
    { kind: 'night', id: 'a', ts: 200, data: { id: 'a', q: 3, ts: 200 } },
    { kind: 'night', id: 'b', ts: 300, deleted: true }
  ])
})

it('keeps the newer side per entry', () => {
  const m = mergeRemote(state(), [
    { kind: 'night', id: 'a', ts: 100, data: { id: 'a', q: 1 } },        // older than local: ignored
    { kind: 'night', id: 'c', ts: 100, data: { id: 'c', q: 5 } },        // new night from the other device
    { kind: 'settings', id: 'main', ts: 50, data: { bedtime: '22:30' } } // server settings beat the defaults
  ])
  expect(m.nights.a.q).toBe(3)
  expect(m.nights.c).toEqual({ id: 'c', q: 5, ts: 100 })
  expect(m.settings).toEqual({ bedtime: '22:30', ts: 50 })
})

it('keeps an entry dirty when it was edited again during the push', () => {
  const s = state()
  const pushed = pendingChanges(s)
  s.nights.a = { ...s.nights.a, q: 4, ts: 250 }
  expect(stillDirty(s, pushed)).toEqual({ 'night:a': true })
})
