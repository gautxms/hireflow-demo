#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_FILE = path.join(ROOT, 'docs/qa/baselines/style-token-violations-baseline.json')
const EXCEPTIONS_FILE = path.join(ROOT, 'docs/BRAND_GUIDELINE_EXCEPTIONS.md')
const SCAN_ROOTS = ['src', 'frontend/src']
const INLINE_STYLE_GUARD_ROOTS = ['src/pages', 'src/components', 'src/admin']
const JSX_EXTENSION = /\.jsx$/
const CSS_EXTENSION = /\.css$/

const TOKENIZED_PATTERN = /var\(--[a-z0-9-]+\)/i
const LEGACY_ALIAS_PATTERN = /--(?:ink|accent|text|muted)\b/i
const LEGACY_TOKEN_PATTERN = /var\(--(?:ink|accent|text|muted)\)/i
const HARD_COLOR_PATTERN = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\(|hsla?\(/i
const FONT_LITERAL_PATTERN = /['\"]?(?:inter|helvetica|arial|roboto|segoe ui|system-ui|sans-serif|serif|monospace)['\"]?/i

const STYLE_PROP_PATTERN = /style\s*=\s*\{\{([\s\S]*?)\}\}/g
const KEY_VALUE_PATTERN = /([a-zA-Z][a-zA-Z0-9]*)\s*:\s*([^,}\n]+|`[^`]*`|'[^']*'|"[^"]*")/g
const CSS_DECLARATION_PATTERN = /(^|\n)\s*([a-zA-Z-]+)\s*:\s*([^;\n]+);/g
const INLINE_ALLOW_MARKER_PATTERN = /\binline-style-allow\b/
const INLINE_STYLE_SPREAD_OR_COMPUTED_PATTERN = /\.\.\.\s*[a-zA-Z_$[{(]|\[[^\]]+\]\s*:/
const INLINE_RUNTIME_PROPERTY_ALLOWLIST = new Set([
  'width', 'minWidth', 'maxWidth',
  'height', 'minHeight', 'maxHeight',
  'top', 'right', 'bottom', 'left',
])

const VARIABLES_CSS_RELATIVE = 'src/styles/variables.css'
const NON_BASELINABLE_RULES = new Set(['legacy-token-alias-forbidden'])


function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === 'dist') continue
      walk(fullPath, files)
    } else if (JSX_EXTENSION.test(item.name) || CSS_EXTENSION.test(item.name)) {
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

function hasInlineAllowMarkerForBlock(content, styleStart) {
  const currentLineStart = content.lastIndexOf('\n', Math.max(0, styleStart - 1)) + 1
  const sameLinePrefix = content.slice(currentLineStart, styleStart)
  if (INLINE_ALLOW_MARKER_PATTERN.test(sameLinePrefix)) return true

  const priorLines = content.slice(0, currentLineStart).split('\n')
  while (priorLines.length > 0 && priorLines[priorLines.length - 1].trim() === '') {
    priorLines.pop()
  }

  const previousNonEmptyLine = priorLines[priorLines.length - 1] || ''
  return INLINE_ALLOW_MARKER_PATTERN.test(previousNonEmptyLine)
}

function scanJsxFile(filePath) {
  const findings = []
  const content = fs.readFileSync(filePath, 'utf8')
  const isInlineGuardScope = INLINE_STYLE_GUARD_ROOTS.some((prefix) => filePath.startsWith(`${prefix}/`) || filePath === prefix)

  for (const styleMatch of content.matchAll(STYLE_PROP_PATTERN)) {
    const styleBody = styleMatch[1]
    const styleStart = styleMatch.index ?? 0
    const styleLine = lineNumberFromIndex(content, styleStart)
    const hasInlineAllowMarker = hasInlineAllowMarkerForBlock(content, styleStart)
    const keyValueMatches = [...styleBody.matchAll(KEY_VALUE_PATTERN)]
    const hasSpreadOrComputedEntries = INLINE_STYLE_SPREAD_OR_COMPUTED_PATTERN.test(styleBody)

    if (isInlineGuardScope && !hasInlineAllowMarker && (keyValueMatches.length === 0 || hasSpreadOrComputedEntries)) {
      findings.push(createFinding({
        filePath,
        line: styleLine,
        rule: 'inline-style-unparseable-forbidden',
        detail: `style={{...}} contains ${keyValueMatches.length === 0 ? 'no parseable key/value pairs' : 'spread/computed entries'} | fix: move to className/tokenized CSS or add adjacent marker comment "inline-style-allow runtime-dimension" for approved runtime-only usage.`,
      }))
    }

    for (const kvMatch of keyValueMatches) {
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

      if (LEGACY_ALIAS_PATTERN.test(rawValue)) {
        findings.push(createFinding({
          filePath,
          line,
          rule: 'legacy-token-alias-forbidden',
          detail: `${property}: ${rawValue}`,
        }))
      }

      const hasHardColor = HARD_COLOR_PATTERN.test(rawValue)
      const hasToken = TOKENIZED_PATTERN.test(rawValue)

      if (hasHardColor && !hasToken) {
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

      if (isInlineGuardScope && !hasInlineAllowMarker) {
        const isRuntimeProperty = INLINE_RUNTIME_PROPERTY_ALLOWLIST.has(property)
        const isDynamicRuntimeValue = rawValue.includes('${') || (
          !/^['"`]/.test(rawValue) &&
          !/^-?\d+(\.\d+)?$/.test(rawValue) &&
          /[a-zA-Z_$][\w.$()[\]]*/.test(rawValue)
        )

        if (!isRuntimeProperty) {
          findings.push(createFinding({
            filePath,
            line,
            rule: 'inline-style-non-runtime-forbidden',
            detail: `${property}: ${rawValue} | fix: move to className/tokenized CSS. If runtime-only dimension/position is required, add marker comment "inline-style-allow runtime-dimension".`,
          }))
          continue
        }

        if (!isDynamicRuntimeValue) {
          findings.push(createFinding({
            filePath,
            line,
            rule: 'inline-style-runtime-value-required',
            detail: `${property}: ${rawValue} | fix: replace static literal with data-driven expression (e.g. width: \`${'${pct}'}%\`) or move to className.`,
          }))
        }
      }
    }
  }

  return findings
}

function scanCssFile(filePath) {
  const findings = []
  const content = fs.readFileSync(filePath, 'utf8')
  const isVariablesFile = filePath === VARIABLES_CSS_RELATIVE

  for (const declMatch of content.matchAll(CSS_DECLARATION_PATTERN)) {
    const property = declMatch[2]
    const rawValue = normalizeValue(declMatch[3])
    const line = lineNumberFromIndex(content, declMatch.index ?? 0)

    if (LEGACY_TOKEN_PATTERN.test(rawValue)) {
      findings.push(createFinding({
        filePath,
        line,
        rule: 'legacy-token-alias-forbidden',
        detail: `${property}: ${rawValue}`,
      }))
    }

    const isLegacyAliasDeclaration = property.startsWith('--') && LEGACY_ALIAS_PATTERN.test(property)
    if (isLegacyAliasDeclaration && !isVariablesFile) {
      findings.push(createFinding({
        filePath,
        line,
        rule: 'legacy-token-alias-forbidden',
        detail: `${property}: ${rawValue}`,
      }))
    }
  }

  return findings
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { generatedAt: null, approvedExceptions: [] }
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))

  if (Array.isArray(parsed.fingerprints)) {
    return {
      generatedAt: parsed.generatedAt || null,
      approvedExceptions: parsed.fingerprints.map((fingerprint) => ({ exceptionId: 'UNTRACKED', fingerprint })),
    }
  }

  return {
    generatedAt: parsed.generatedAt || null,
    approvedExceptions: Array.isArray(parsed.approvedExceptions) ? parsed.approvedExceptions : [],
  }
}

function writeBaseline(approvedExceptions) {
  const payload = {
    generatedAt: new Date().toISOString(),
    approvedExceptions: approvedExceptions
      .map((entry) => ({
        exceptionId: entry.exceptionId,
        fingerprint: entry.fingerprint,
      }))
      .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  }

  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`)
}

function readApprovedExceptionIds() {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return new Set()
  const content = fs.readFileSync(EXCEPTIONS_FILE, 'utf8')
  return new Set(Array.from(content.matchAll(/\b(BGX-\d+)\b/g)).map((m) => m[1]))
}

function main() {
  const shouldWriteBaseline = process.argv.includes('--write-baseline')
  const baselineExceptionIdArg = process.argv.find((arg) => arg.startsWith('--exception-id=')) || ''
  const selectedExceptionId = baselineExceptionIdArg.replace('--exception-id=', '') || 'BGX-004'
  const files = SCAN_ROOTS.flatMap((scanRoot) => walk(path.join(ROOT, scanRoot)))
  const findings = files.flatMap((filePath) => {
    const relativePath = path.relative(ROOT, filePath)
    if (JSX_EXTENSION.test(filePath)) return scanJsxFile(relativePath)
    if (CSS_EXTENSION.test(filePath)) return scanCssFile(relativePath)
    return []
  })

  const baseline = readBaseline()
  const approvedIds = readApprovedExceptionIds()

  const validApprovedEntries = baseline.approvedExceptions.filter((entry) => approvedIds.has(entry.exceptionId))
  const droppedEntryCount = baseline.approvedExceptions.length - validApprovedEntries.length
  const baselineSet = new Set(validApprovedEntries.map((entry) => entry.fingerprint))
  const newFindings = findings.filter((finding) => NON_BASELINABLE_RULES.has(finding.rule) || !baselineSet.has(finding.fingerprint))

  if (shouldWriteBaseline) {
    const approvedMatches = findings
      .filter((finding) => !NON_BASELINABLE_RULES.has(finding.rule))
      .map((finding) => {
        const matched = validApprovedEntries.find((entry) => entry.fingerprint === finding.fingerprint)
        if (matched) {
          return { exceptionId: matched.exceptionId, fingerprint: finding.fingerprint }
        }
        return { exceptionId: selectedExceptionId, fingerprint: finding.fingerprint }
      })

    writeBaseline(approvedMatches)
    console.log(`✅ Wrote baseline with ${approvedMatches.length} approved exception finding(s) to ${path.relative(ROOT, BASELINE_FILE)} (new findings tagged with ${selectedExceptionId}).`)
    const nonBaselinableCount = findings.filter((finding) => NON_BASELINABLE_RULES.has(finding.rule)).length
    if (nonBaselinableCount > 0) {
      console.log(`ℹ️ Skipped ${nonBaselinableCount} non-baselinable finding(s): ${Array.from(NON_BASELINABLE_RULES).join(', ')}.`)
    }
    if (droppedEntryCount > 0) {
      console.log(`ℹ️ Dropped ${droppedEntryCount} unapproved baseline entries (missing/invalid exception IDs).`)
    }
    return
  }

  if (newFindings.length > 0) {
    console.error('❌ New style-token compliance violations found:')
    for (const finding of newFindings) {
      console.error(`- ${finding.filePath}:${finding.line} [${finding.rule}] ${finding.detail}`)
    }
    console.error('\nOnly explicitly approved exceptions from docs/BRAND_GUIDELINE_EXCEPTIONS.md may be baselined.')
    console.error('Update docs/qa/baselines/style-token-violations-baseline.json with { exceptionId, fingerprint } entries as needed.')
    process.exit(1)
  }

  if (droppedEntryCount > 0) {
    console.log(`⚠️ Ignored ${droppedEntryCount} baseline entries because they are not linked to approved exception IDs.`)
  }

  console.log(`✅ Style-token scan passed. ${findings.length} finding(s), ${baselineSet.size} approved baseline exception(s), 0 new.`)
}

main()
