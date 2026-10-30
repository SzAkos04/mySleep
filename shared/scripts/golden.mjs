// What the rules make of the fixed night (ios/NightKit/Tests/NightKitTests/Fixtures/fixture.js),
// run in node as the bundle runs in the app: node scripts/golden.mjs [--print]. The fixture makes
// local time UTC, so the clock times in it do not depend on the Mac.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = p => fileURLToPath(new URL(p, import.meta.url))
export const FIXTURES = here('../../ios/NightKit/Tests/NightKitTests/Fixtures/')

export function golden() {
  const ctx = vm.createContext({})
  vm.runInContext(readFileSync(here('../../ios/MySleepNight/rules.js'), 'utf8'), ctx)
  vm.runInContext(readFileSync(FIXTURES + 'fixture.js', 'utf8'), ctx)
  return JSON.stringify(vm.runInContext('goldenOutputs()', ctx), null, 1) + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--print')) process.stdout.write(golden())
  else { writeFileSync(FIXTURES + 'golden.json', golden()); console.log('wrote golden.json') }
}
