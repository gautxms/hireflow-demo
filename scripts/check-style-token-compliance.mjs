#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_FILE = path.join(ROOT, 'docs/qa/baselines/style-token-violations-baseline.json')
const SCAN_ROOTS = ['src', 'frontend/src']
const JSX_EXTENSION = /\.jsx$/

const TOKENIZED_PATTERN = /var\(--[a-z0-9-]+\)/i
const LEGACY_TOKEN_PATTERN = /var\(--(?:ink(?:-2)?|text|muted|border|card|accent(?:-2)?|font-(?:body|display))\)/i
const HARD_COLOR_PATTERN = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\(|hsla?\(/i
const FONT_LITERAL_PATTERN = /['\"]?(?:inter|helvetica|arial|roboto|segoe ui|system-ui|sans-serif|serif|monospace)['\"]?/i

const STYLE_PROP_PATTERN = /style\s*=\s*\{\{([\s\S]*?)\}\}/g
const KEY_VALUE_PATTERN = /([a-zA-Z][a-zA-Z0-9]*)\s*:\s*([^,}\n]+|`[^`]*`|'[^']*'|"[^"]*")/g

const COLOR_KEYS = new Set([
  'color', 'background', 'backgroundColor', 'borderColor', 'outlineColor', 'textDecorationColor',
  'boxShadow', 'fill', 'stroke', 'caretColor'
])

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === 'dist') continue
      walk(fullPath, files)
    } else if (JSX_EXTENSION.test(item.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function normalizeValue(rawValue) {
  return rawValue.trim().replace(/,$/, '')
}

function lineNumberFromIndex(content, index) {
  return content.slice(0, index).split('\n').length
}

function createFinding({ filePath, line, rule, detail }) {
  return {
    fingerprint: `${filePath}:${line}:${rule}:${detail}`,
    filePath,
    line,
    rule,
    detail,
  }
}

function scanFile(filePath) {
  const findings = []
  const content = fs.readFileSync(filePath, 'utf8')

  for (const styleMatch of content.matchAll(STYLE_PROP_PATTERN)) {
    const styleBody = styleMatch[1]
    const styleStart = styleMatch.index ?? 0

    for (const kvMatch of styleBody.matchAll(KEY_VALUE_PATTERN)) {
      const property = kvMatch[1]
      const rawValue = normalizeValue(kvMatch[2])
      const kvStart = styleStart + (kvMatch.index ?? 0)
      const line = lineNumberFromIndex(content, kvStart)

      if (property === 'fontFamily') {
        const hasToken = TOKENIZED_PATTERN.test(rawValue)
        if (!hasToken && FONT_LITERAL_PATTERN.test(rawValue)) {
          findings.push(createFinding({
            filePath,
            line,
            rule: 'font-family-must-use-token',
            detail: `${property}: ${rawValue}`,
          }))
        }
      }

      const isColorProperty = COLOR_KEYS.has(property)
      const hasHardColor = HARD_COLOR_PATTERN.test(rawValue)
      const hasToken = TOKENIZED_PATTERN.test(rawValue)
      const hasLegacyToken = LEGACY_TOKEN_PATTERN.test(rawValue)

      if (hasLegacyToken) {
        findings.push(createFinding({
          filePath,
          line,
          rule: 'legacy-token-alias-forbidden',
          detail: `${property}: ${rawValue}`,
        }))
      }

      if (isColorProperty && hasHardColor && !hasToken) {
        findings.push(createFinding({
          filePath,
          line,
          rule: 'hardcoded-color-forbidden',
          detail: `${property}: ${rawValue}`,
        }))
      }

      if (property === 'background' && rawValue.includes('linear-gradient(') && !rawValue.includes('var(--')) {
        findings.push(createFinding({
          filePath,
          line,
          rule: 'non-tokenized-background-forbidden',
          detail: `${property}: ${rawValue}`,
        }))
      }
    }
  }

  return findings
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { generatedAt: null, fingerprints: [] }
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
}

function writeBaseline(fingerprints) {
  const payload = {
    generatedAt: new Date().toISOString(),
    fingerprints: Array.from(new Set(fingerprints)).sort(),
  }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`)
}

function main() {
  const shouldWriteBaseline = process.argv.includes('--write-baseline')
  const files = SCAN_ROOTS.flatMap((scanRoot) => walk(path.join(ROOT, scanRoot)))
  const findings = files.flatMap((filePath) => scanFile(path.relative(ROOT, filePath)))

  if (shouldWriteBaseline) {
    writeBaseline(findings.map((finding) => finding.fingerprint))
    console.log(`✅ Wrote baseline with ${findings.length} known findings to ${path.relative(ROOT, BASELINE_FILE)}.`)
    return
  }

  const baseline = readBaseline()
  const baselineSet = new Set(baseline.fingerprints || [])
  const newFindings = findings.filter((finding) => !baselineSet.has(finding.fingerprint))

  if (newFindings.length > 0) {
    console.error('❌ New style-token compliance violations found:')
    for (const finding of newFindings) {
      console.error(`- ${finding.filePath}:${finding.line} [${finding.rule}] ${finding.detail}`)
    }
    console.error(`\nIf intentional, refresh baseline with: node scripts/check-style-token-compliance.mjs --write-baseline`)
    process.exit(1)
  }

  console.log(`✅ Style-token scan passed. ${findings.length} known baseline finding(s), 0 new.`)
}

main()
