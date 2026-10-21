// Client side of POST /api/sync. Every night (and the one settings record) carries `ts`, the time
// of its last edit; the newer edit wins per entry, on the server and here. `dirty` lists the
// entries edited on this device that the server has not confirmed yet ("night:<id>", "settings:main").

const entryOf = (state, key) => {
  const [kind, id] = key.split(/:(.*)/)
  return kind === 'settings' ? state.settings : state.nights[id]
}

export function pendingChanges(state) {
  return Object.keys(state.dirty).map(key => {
    const [kind, id] = key.split(/:(.*)/)
    const data = entryOf(state, key)
    return data?.deleted ? { kind, id, ts: data.ts, deleted: true } : { kind, id, ts: data.ts, data }
  })
}

// Remote changes into local state; a local edit newer than the remote one stays.
export function mergeRemote(state, changes) {
  const nights = { ...state.nights }
  let settings = state.settings
  for (const c of changes) {
    const local = c.kind === 'settings' ? settings : nights[c.id]
    if (local && local.ts >= c.ts) continue
    const v = c.deleted ? { id: c.id, deleted: true, ts: c.ts } : { ...c.data, ts: c.ts }
    if (c.kind === 'settings') settings = v
    else nights[c.id] = v
  }
  return { nights, settings }
}

// What is still dirty after a push: entries edited again while the push was in flight.
export function stillDirty(state, pushed) {
  const dirty = { ...state.dirty }
  for (const c of pushed) if (entryOf(state, c.kind + ':' + c.id)?.ts === c.ts) delete dirty[c.kind + ':' + c.id]
  return dirty
}
