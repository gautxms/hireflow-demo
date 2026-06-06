import { Buffer } from 'node:buffer'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const PDF_MAGIC = Buffer.from('%PDF', 'ascii')
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 1500
const BUILTIN_PARSER_VERSION = 'builtin-pdf-selectable-text-v1'
const EXTRACTION_METHOD = 'pdf_selectable_text_observe_only_builtin'
const SECTION_MARKERS = ['summary', 'skills', 'experience', 'education', 'certification', 'projects']
const TEXT_FINGERPRINT_VERSION = 'resume-text-fingerprint-v1'
const NULL_CHARACTER = String.fromCharCode(0)
const CATEGORY = {
  usable: 'usable_text_extraction',
  lowDensity: 'low_text_density',
  scanned: 'likely_scanned_pdf',
  noise: 'suspicious_noise',
  malformed: 'malformed_pdf',
  timeout: 'parser_timeout',
  error: 'parser_error',
}


function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function normalizeResumeTextForFingerprint(text = '') {
  return String(text || '')
    .normalize('NFKC')
    .split(NULL_CHARACTER).join(' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
    .filter((line) => !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line))
    .filter((line) => !/^(confidential|curriculum vitae|resume)$/i.test(line))
    .join('\n')
}

function buildResumeTextFingerprint(text = '') {
  const normalizedText = normalizeResumeTextForFingerprint(text)
  if (!normalizedText) {
    return {
      version: TEXT_FINGERPRINT_VERSION,
      comparable: false,
      reason: 'empty_normalized_text',
      normalizedCharCount: 0,
      normalizedLineCount: 0,
      sha256: null,
    }
  }

  return {
    version: TEXT_FINGERPRINT_VERSION,
    comparable: true,
    reason: null,
    normalizedCharCount: normalizedText.length,
    normalizedLineCount: normalizedText.split('\n').length,
    sha256: createHash('sha256').update(normalizedText).digest('hex'),
  }
}

function getLines(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function isPrintableOrWhitespace(char) {
  if (!char) return false
  if (/\s/u.test(char)) return true
  const codePoint = char.codePointAt(0)
  return codePoint >= 0x20 && codePoint !== 0x7f && codePoint !== 0xfffd
}

function isSuspiciousNoise(char) {
  if (!char) return false
  const codePoint = char.codePointAt(0)
  if (codePoint === 0xfffd || codePoint === 0x00 || codePoint === 0x7f) return true
  return codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)
}

function calculateSafeTextQualityMetrics(text = '', expectedMarkers = []) {
  const safeText = String(text || '')
  const chars = [...safeText]
  const lines = getLines(safeText)
  const normalizedText = safeText.toLowerCase()
  const normalizedMarkers = expectedMarkers.map((marker) => String(marker || '').trim()).filter(Boolean)
  const markersFound = normalizedMarkers.filter((marker) => normalizedText.includes(marker.toLowerCase()))
  const duplicateLineCount = Math.max(0, lines.length - new Set(lines.map((line) => line.toLowerCase())).size)
  const printableCount = chars.filter(isPrintableOrWhitespace).length
  const suspiciousCount = chars.filter(isSuspiciousNoise).length

  return {
    extractedTextLength: safeText.length,
    lineCount: lines.length,
    printableRatio: chars.length > 0 ? round(printableCount / chars.length) : 0,
    duplicateLineRatio: lines.length > 0 ? round(duplicateLineCount / lines.length) : 0,
    suspiciousNoiseRatio: chars.length > 0 ? round(suspiciousCount / chars.length) : 0,
    safeMarkerCoverage: {
      expected: normalizedMarkers.length,
      found: markersFound.length,
      ratio: normalizedMarkers.length > 0 ? round(markersFound.length / normalizedMarkers.length) : 1,
    },
  }
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

export function isPdfCanonicalExtractionObserveOnlyEnabled(env = process.env) {
  return TRUE_VALUES.has(String(env?.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED || '').trim().toLowerCase())
}

export function getPdfCanonicalExtractionObserveOnlyLimits(env = process.env) {
  return {
    maxBytes: normalizePositiveInteger(env?.PDF_CANONICAL_EXTRACTION_MAX_BYTES, DEFAULT_MAX_BYTES),
    timeoutMs: normalizePositiveInteger(env?.PDF_CANONICAL_EXTRACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }
}

function createDeadline(timeoutMs) {
  return performance.now() + timeoutMs
}

function assertWithinDeadline(deadline) {
  if (performance.now() > deadline) {
    const error = new Error('parser_timeout')
    error.category = CATEGORY.timeout
    throw error
  }
}

function hasPdfMagic(fileBuffer) {
  return Buffer.isBuffer(fileBuffer) && fileBuffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

function buildErrorFingerprint(error) {
  const normalized = String(error?.message || error?.category || 'unknown').trim().toLowerCase()
  return createHash('sha256').update(`pdf-observe-error-v1:${normalized}`).digest('hex').slice(0, 16)
}

function decodePdfEscapes(value = '') {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '\\') {
      output += char
      continue
    }
    const next = value[index + 1]
    if (next === undefined) break
    if (next === 'n') output += '\n'
    else if (next === 'r') output += '\n'
    else if (next === 't') output += '\t'
    else if (next === 'b' || next === 'f') output += ' '
    else if (next === '(' || next === ')' || next === '\\') output += next
    else if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] || next
      output += String.fromCharCode(Number.parseInt(octal, 8))
      index += octal.length - 1
    } else {
      output += next
    }
    index += 1
  }
  return output
}

function decodeHexPdfString(value = '') {
  const normalized = String(value || '').replace(/[^a-f0-9]/gi, '')
  const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`
  const bytes = []
  for (let index = 0; index < padded.length; index += 2) {
    bytes.push(Number.parseInt(padded.slice(index, index + 2), 16))
  }
  return Buffer.from(bytes).toString('utf8')
}

function extractLiteralStrings(content = '', deadline) {
  const strings = []
  for (let index = 0; index < content.length; index += 1) {
    if (index % 4096 === 0) assertWithinDeadline(deadline)
    if (content[index] !== '(') continue
    let depth = 1
    let escaped = false
    let value = ''
    for (let cursor = index + 1; cursor < content.length; cursor += 1) {
      const char = content[cursor]
      if (escaped) {
        value += `\\${char}`
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '(') {
        depth += 1
        value += char
        continue
      }
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          strings.push(decodePdfEscapes(value))
          index = cursor
          break
        }
      } else {
        value += char
      }
    }
  }
  return strings
}

function extractHexStrings(content = '', deadline) {
  const strings = []
  const regex = /<([a-f0-9\s]{4,})>/gi
  let match
  while ((match = regex.exec(content))) {
    assertWithinDeadline(deadline)
    strings.push(decodeHexPdfString(match[1]))
  }
  return strings
}

function normalizePdfExtractedText(strings = []) {
  return strings
    .map((item) => String(item || '').normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' '))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function countPdfPages(bufferText = '') {
  const matches = bufferText.match(/\/Type\s*\/Page\b/g)
  return Array.isArray(matches) ? matches.length : null
}

function extractTextWithBuiltinParser(fileBuffer, deadline) {
  const bufferText = fileBuffer.toString('latin1')
  const strings = []
  const streamRegex = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g
  let match
  while ((match = streamRegex.exec(bufferText))) {
    assertWithinDeadline(deadline)
    const stream = match[1] || ''
    strings.push(...extractLiteralStrings(stream, deadline), ...extractHexStrings(stream, deadline))
  }

  if (strings.length === 0) {
    strings.push(...extractLiteralStrings(bufferText, deadline), ...extractHexStrings(bufferText, deadline))
  }

  return {
    extractedText: normalizePdfExtractedText(strings),
    pageCount: countPdfPages(bufferText),
  }
}

function classifyPdfExtraction({ text, metrics, byteSize, pageCount }) {
  const textLength = String(text || '').length
  const pages = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Number(pageCount) : 1
  const textDensity = byteSize > 0 ? textLength / byteSize : 0
  const charsPerPage = textLength / pages
  const ocrRequired = textLength < 80 || charsPerPage < 80

  if (textLength === 0 || charsPerPage < 20) {
    return { qualityClassification: CATEGORY.scanned, ocrRequired: true }
  }
  if (metrics.suspiciousNoiseRatio > 0.05 || metrics.printableRatio < 0.92) {
    return { qualityClassification: CATEGORY.noise, ocrRequired }
  }
  if (textLength < 200 || charsPerPage < 120 || textDensity < 0.015) {
    return { qualityClassification: CATEGORY.lowDensity, ocrRequired }
  }
  return { qualityClassification: CATEGORY.usable, ocrRequired: false }
}

function buildFailureResult({ category, startedAt, fileBuffer, error = null }) {
  return {
    enabled: true,
    success: false,
    extractionMethod: EXTRACTION_METHOD,
    parserVersion: BUILTIN_PARSER_VERSION,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    inputByteSize: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0,
    pageCount: null,
    lineCount: 0,
    extractedTextLength: 0,
    normalizedFingerprint: null,
    normalizedTextCharCount: 0,
    normalizedTextLineCount: 0,
    printableRatio: 0,
    suspiciousNoiseRatio: 0,
    duplicateLineRatio: 0,
    safeSectionMarkerCoverage: { expected: SECTION_MARKERS.length, found: 0, ratio: 0 },
    qualityClassification: category,
    ocrRequired: category === CATEGORY.scanned,
    failureCategory: category,
    errorFingerprint: error ? buildErrorFingerprint(error) : null,
  }
}

export async function observePdfCanonicalTextExtraction(fileBuffer, options = {}) {
  const { env = process.env } = options || {}
  const startedAt = performance.now()
  const limits = getPdfCanonicalExtractionObserveOnlyLimits(env)

  try {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0 || !hasPdfMagic(fileBuffer)) {
      return buildFailureResult({ category: CATEGORY.malformed, startedAt, fileBuffer })
    }
    if (fileBuffer.length > limits.maxBytes) {
      return buildFailureResult({ category: CATEGORY.error, startedAt, fileBuffer, error: new Error('file_too_large') })
    }

    const deadline = createDeadline(limits.timeoutMs)
    const { extractedText, pageCount } = extractTextWithBuiltinParser(fileBuffer, deadline)
    const canonicalText = normalizeResumeTextForFingerprint(extractedText)
    const fingerprint = buildResumeTextFingerprint(canonicalText)
    const metrics = calculateSafeTextQualityMetrics(canonicalText, SECTION_MARKERS)
    const classification = classifyPdfExtraction({ text: canonicalText, metrics, byteSize: fileBuffer.length, pageCount })

    return {
      enabled: true,
      success: true,
      extractionMethod: EXTRACTION_METHOD,
      parserVersion: BUILTIN_PARSER_VERSION,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      inputByteSize: fileBuffer.length,
      pageCount,
      lineCount: metrics.lineCount,
      extractedTextLength: extractedText.length,
      canonicalTextLength: canonicalText.length,
      normalizedFingerprint: fingerprint?.sha256 || null,
      normalizedTextCharCount: fingerprint?.normalizedCharCount || 0,
      normalizedTextLineCount: fingerprint?.normalizedLineCount || 0,
      printableRatio: metrics.printableRatio,
      suspiciousNoiseRatio: metrics.suspiciousNoiseRatio,
      duplicateLineRatio: metrics.duplicateLineRatio,
      safeSectionMarkerCoverage: metrics.safeMarkerCoverage,
      qualityClassification: classification.qualityClassification,
      ocrRequired: classification.ocrRequired,
      failureCategory: null,
    }
  } catch (error) {
    const category = error?.category === CATEGORY.timeout ? CATEGORY.timeout : CATEGORY.error
    return buildFailureResult({ category, startedAt, fileBuffer, error })
  }
}

export function logSafePdfCanonicalExtractionDiagnostics(logger, diagnostics) {
  const target = diagnostics?.success ? (logger?.info || logger?.log) : (logger?.warn || logger?.log)
  if (typeof target === 'function') {
    target.call(logger, '[ResumeDiagnostics] pdf_canonical_extraction_observe_only', diagnostics)
  }
}

export const PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_CATEGORIES = CATEGORY
