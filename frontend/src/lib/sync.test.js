import { it, expect } from 'vitest'
import { pendingChanges, mergeRemote, stillDirty, withNight, withoutNight, withSettings, afterSync } from './sync.js'

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

// The store's edits and the end of a sync as plain functions of the state, so mySleep Night runs
// the very same ones (lib/rules.js) on a state it keeps as JSON.
it('saving a night stamps it and marks it to send; deleting leaves a stamped tombstone', () => {
  const s = { nights: {}, dirty: {} }
  expect(withNight(s, { id: 'a', q: 1 }, 500)).toEqual({ nights: { a: { id: 'a', q: 1, ts: 500 } }, dirty: { 'night:a': true } })
  expect(withoutNight({ nights: { a: { id: 'a', q: 1, ts: 500 } }, dirty: {} }, 'a', 600)).toEqual({ nights: { a: { id: 'a', deleted: true, ts: 600 } }, dirty: { 'night:a': true } })
})

it('changing settings merges the change, stamps it and marks it to send', () => {
  expect(withSettings({ settings: { wake: '06:45', bedtime: '23:00', ts: 1 }, dirty: {} }, { wake: '07:00' }, 700))
    .toEqual({ settings: { wake: '07:00', bedtime: '23:00', ts: 700 }, dirty: { 'settings:main': true } })
})

it('the end of a sync: what came is merged, the revision kept, what was pushed is clean', () => {
  const s = { ...state(), rev: 3, lastSynced: null }
  const pushed = pendingChanges(s)
  const r = afterSync(s, { rev: 9, changes: [{ kind: 'night', id: 'c', ts: 100, data: { id: 'c', q: 5 } }] }, pushed, 999)
  expect(r.rev).toBe(9)
  expect(r.lastSynced).toBe(999)
  expect(r.nights.c).toEqual({ id: 'c', q: 5, ts: 100 })
  expect(r.dirty).toEqual({})
})
