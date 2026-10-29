import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import { bundle, OUT } from '../../scripts/build-rules.mjs'
import { FIXTURES } from '../../scripts/golden.mjs'
import * as direct from './rules.js'

// mySleep Night runs ios/MySleepNight/rules.js, a bundle of rules.js: it has to be the bundle of
// what is here now, and give what the modules give.
describe('the rules bundle for the app', () => {
  it('is current: rebuild it with `node scripts/build-rules.mjs`', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundle())
  })
  it('runs as a plain script and gives what the modules give', () => {
    const ctx = vm.createContext({})
    vm.runInContext(readFileSync(OUT, 'utf8'), ctx)
    expect(Object.keys(ctx.MySleepRules).sort()).toEqual(Object.keys(direct).sort())
    expect(vm.runInContext("MySleepRules.dur(125)", ctx)).toBe(direct.dur(125))
    expect(vm.runInContext("MySleepRules.canonical({b:1.23456789,a:[2]})", ctx)).toBe('{"a":[2],"b":1.234568}')
  })
  it('has a golden file for NightKit that is current: `node scripts/golden.mjs`', () => {
    const now = execFileSync('node', ['scripts/golden.mjs', '--print'], { cwd: new URL('../..', import.meta.url).pathname }).toString()
    expect(readFileSync(FIXTURES + 'golden.json', 'utf8')).toBe(now)
  })
})
