import { createHash } from 'node:crypto'

const TEXT_FINGERPRINT_VERSION = 'resume-text-fingerprint-v1'
const NULL_CHARACTER = String.fromCharCode(0)

export function normalizeResumeTextForFingerprint(text = '') {
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

export function buildResumeTextFingerprint(text = '') {
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

export function compareResumeTextFingerprints(leftText = '', rightText = '') {
  const left = buildResumeTextFingerprint(leftText)
  const right = buildResumeTextFingerprint(rightText)
  return {
    comparable: Boolean(left.comparable && right.comparable),
    equivalent: Boolean(left.comparable && right.comparable && left.sha256 === right.sha256),
    left,
    right,
    charCountDelta: Math.abs(Number(left.normalizedCharCount || 0) - Number(right.normalizedCharCount || 0)),
    lineCountDelta: Math.abs(Number(left.normalizedLineCount || 0) - Number(right.normalizedLineCount || 0)),
  }
}
