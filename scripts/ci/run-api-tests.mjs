#!/usr/bin/env node
import { spawn } from 'node:child_process'

const suites = [
  'tests/feature-flags.api.test.mjs',
  'tests/admin.api.test.mjs',
  'tests/crm.api.test.mjs',
  'tests/membership.api.test.mjs',
  'tests/reschedule.api.test.mjs',
  'tests/promo.api.test.mjs',
]

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      cwd: process.cwd(),
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

async function main() {
  const env = { ...process.env }
  for (const suite of suites) {
    console.log(`\n[ci] running ${suite}`)
    await run('node', ['--test', suite], env)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
