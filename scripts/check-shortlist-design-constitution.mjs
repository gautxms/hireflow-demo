#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const checks = [
  {
    name: 'layout pattern order compliance',
    cmd: 'npm',
    args: ['run', 'lint:primitives'],
  },
  {
    name: 'state treatment compliance',
    cmd: 'node',
    args: ['--test', 'src/components/shortlistState.test.js'],
  },
  {
    name: 'typography compliance',
    cmd: 'npm',
    args: ['run', 'lint:style-tokens'],
  },
  {
    name: 'pagination parity compliance',
    cmd: 'node',
    args: ['--test', 'src/pages/analysesPaginationState.test.js'],
  },
]

let hasFailure = false

for (const check of checks) {
  const rendered = `${check.cmd} ${check.args.join(' ')}`
  process.stdout.write(`\n[shortlist-constitution] Running: ${check.name} (${rendered})\n`)
  const result = spawnSync(check.cmd, check.args, { stdio: 'inherit', shell: false })

  if (result.status !== 0) {
    hasFailure = true
    process.stderr.write(`[shortlist-constitution] FAILED: ${check.name}\n`)
  } else {
    process.stdout.write(`[shortlist-constitution] PASSED: ${check.name}\n`)
  }
}

if (hasFailure) {
  process.exitCode = 1
  process.stderr.write('\n[shortlist-constitution] Sign-off gate failed.\n')
} else {
  process.stdout.write('\n[shortlist-constitution] All design constitution checks passed.\n')
}
