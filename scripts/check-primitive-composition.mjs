#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_FILE = path.join(ROOT, 'docs/qa/baselines/primitive-composition-violations-baseline.json')
const EXCEPTIONS_FILE = path.join(ROOT, 'docs/PRIMITIVE_COMPOSITION_EXCEPTIONS.md')
const CRITICAL_DIRS = [
  'src/components',
  'src/pages',
  'src/admin/components',
  'src/admin/pages',
]
const JSX_FILE = /\.(jsx|tsx)$/

const PROHIBITED_UTILITY_PATTERN = /\b(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/i

function extractClassNameAssignments(content) {
  const assignments = []
  const marker = /className\s*=\s*/g

  for (const match of content.matchAll(marker)) {
    let cursor = (match.index ?? 0) + match[0].length
    while (cursor < content.length && /\s/.test(content[cursor])) cursor += 1
    if (cursor >= content.length) continue

    const startIndex = match.index ?? 0
    const delimiter = content[cursor]

    if (delimiter === '"' || delimiter === "'") {
      const closing = content.indexOf(delimiter, cursor + 1)
      if (closing === -1) continue
      assignments.push({ rawValue: content.slice(cursor + 1, closing), index: startIndex })
      continue
    }

    if (delimiter !== '{') continue

    let depth = 0
    let inSingleQuote = false
    let inDoubleQuote = false
    let inTemplate = false
    let escaped = false

    for (let i = cursor; i < content.length; i += 1) {
      const char = content[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === "'" && !inDoubleQuote && !inTemplate) {
        inSingleQuote = !inSingleQuote
        continue
      }
      if (char === '"' && !inSingleQuote && !inTemplate) {
        inDoubleQuote = !inDoubleQuote
        continue
      }
      if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inTemplate = !inTemplate
        continue
      }

      if (inSingleQuote || inDoubleQuote || inTemplate) continue

      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          assignments.push({ rawValue: content.slice(cursor + 1, i), index: startIndex })
          break
        }
      }
    }
  }

  return assignments
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(fullPath, output)
      continue
    }
    if (JSX_FILE.test(entry.name)) output.push(fullPath)
  }
  return output
}

function getLine(content, index) {
  return content.slice(0, index).split('\n').length
}

function createFinding({ filePath, line, detail }) {
  return {
    fingerprint: `${filePath}:${line}:primitive-bypass-utility:${detail}`,
    filePath,
    line,
    rule: 'primitive-bypass-utility',
    detail,
  }
}

function findViolations(filePath) {
  const relative = path.relative(ROOT, filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const findings = []

  for (const assignment of extractClassNameAssignments(content)) {
    const classValue = assignment.rawValue
    if (!PROHIBITED_UTILITY_PATTERN.test(classValue)) continue

    const badToken = classValue.match(PROHIBITED_UTILITY_PATTERN)?.[0] || 'unknown-token'
    findings.push(createFinding({
      filePath: relative,
      line: getLine(content, assignment.index),
      detail: `className contains prohibited utility token \"${badToken}\"`,
    }))
  }

  return findings
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { generatedAt: null, approvedExceptions: [] }
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  return {
    generatedAt: parsed.generatedAt || null,
    approvedExceptions: Array.isArray(parsed.approvedExceptions) ? parsed.approvedExceptions : [],
  }
}

function readApprovedExceptionIds() {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return new Set()
  const content = fs.readFileSync(EXCEPTIONS_FILE, 'utf8')
  return new Set(Array.from(content.matchAll(/\b(PCX-\d+)\b/g)).map((m) => m[1]))
}

function writeBaseline(entries) {
  const payload = {
    generatedAt: new Date().toISOString(),
    approvedExceptions: entries
      .map((entry) => ({ exceptionId: entry.exceptionId, fingerprint: entry.fingerprint }))
      .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`)
}

function main() {
  const shouldWriteBaseline = process.argv.includes('--write-baseline')
  const requestedExceptionId = process.argv.find((arg) => arg.startsWith('--exception-id='))?.split('=')[1] || null

  const files = CRITICAL_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))
  const findings = files.flatMap((filePath) => findViolations(filePath))

  const baseline = readBaseline()
  const approvedIds = readApprovedExceptionIds()
  const validBaselineEntries = baseline.approvedExceptions.filter((entry) => approvedIds.has(entry.exceptionId))
  const baselineSet = new Set(validBaselineEntries.map((entry) => entry.fingerprint))
  const newFindings = findings.filter((finding) => !baselineSet.has(finding.fingerprint))

  if (shouldWriteBaseline) {
    if (!requestedExceptionId) {
      console.error('❌ Missing required flag: --exception-id=PCX-XXX')
      process.exit(1)
    }
    if (!approvedIds.has(requestedExceptionId)) {
      console.error(`❌ Unknown exception id ${requestedExceptionId}. Add it to ${path.relative(ROOT, EXCEPTIONS_FILE)} first.`)
      process.exit(1)
    }

    const entries = findings.map((finding) => ({ exceptionId: requestedExceptionId, fingerprint: finding.fingerprint }))
    writeBaseline(entries)
    console.log(`✅ Wrote primitive composition baseline (${entries.length} finding(s)) using exception ${requestedExceptionId}.`)
    return
  }

  if (newFindings.length > 0) {
    console.error('❌ New primitive-composition violations found:')
    for (const finding of newFindings) {
      console.error(`- ${finding.filePath}:${finding.line} [${finding.rule}] ${finding.detail}`)
    }
    console.error('\nUse approved primitives for new UI. If this is unavoidable, add an approved PCX exception and baseline entry.')
    process.exit(1)
  }

  console.log(`✅ Primitive composition scan passed. ${findings.length} finding(s), ${baselineSet.size} approved baseline exception(s), 0 new.`)
}

main()
