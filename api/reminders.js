// When to remind about reinstalling mySleep Night (the native app). Signed with a free Apple ID, it
// stops working 7 days after it was installed; it tells the server when (POST /api/devices/status),
// and server.js's tick sends what this returns as a web push. Pure, so it is tested on its own.

const STAGES = ['soon', 'today', 'expired']

function local(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'long' })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { day: Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5, hour: +p.hour, weekday: p.weekday }
}

// A stage at most once each (device.reminded keeps the last one sent), between 9:00 and 21:00.
export function expiryReminder(device, now, tz) {
  if (!Number.isFinite(device.expires)) return null
  const n = local(now, tz), e = local(device.expires, tz)
  if (n.hour < 9 || n.hour >= 21) return null
  const days = e.day - n.day
  const stage = now >= device.expires ? 'expired' : days === 0 ? 'today' : days <= 2 ? 'soon' : null
  if (!stage || STAGES.indexOf(stage) <= STAGES.indexOf(device.reminded)) return null
  return {
    stage,
    tag: 'reinstall',
    ...{
      soon: { title: `mySleep Night stops on ${e.weekday}`, body: 'Reinstall it from the Mac before then: connect the iPhone and run the install.' },
      today: { title: 'mySleep Night stops tonight', body: 'Reinstall it from the Mac today, or tonight will not be recorded.' },
      expired: { title: 'mySleep Night has stopped', body: 'It cannot record a night until it is reinstalled from the Mac.' }
    }[stage]
  }
}
