#!/usr/bin/env node
import fs from 'node:fs'

const targets = [
  { file: 'src/components/NewDashboard.css', allowlist: [] },
  { file: 'src/globals.css', allowlist: [], selectorScope: /(app-sb|app-shell|user-app-shell)/ },
]

const hardColorPattern = /#(?:[0-9a-fA-F]{3,8})\b/g
const violations = []

for (const target of targets) {
  const content = fs.readFileSync(target.file, 'utf8')
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    if (target.selectorScope && !target.selectorScope.test(line)) return
    const matches = line.match(hardColorPattern)
    if (!matches) return
    for (const hex of matches) {
      const isAllowed = target.allowlist.includes(hex.toLowerCase())
      if (!isAllowed) {
        violations.push(`${target.file}:${index + 1} contains hardcoded hex ${hex}`)
      }
    }
  })
}

if (violations.length > 0) {
  console.error('Dashboard/App Shell token hygiene check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Dashboard/App Shell token hygiene check passed.')
