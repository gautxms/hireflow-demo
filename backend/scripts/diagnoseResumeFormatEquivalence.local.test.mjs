import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildOnlyInFormatHashCounts,
  buildSafeExtractionEquivalenceReport,
  buildSafeLineFingerprintSummary,
  runExtractionEquivalenceFromLocalFixtures,
} from './diagnoseResumeFormatEquivalence.local.mjs'

const TEXT_A = [
  'Synthetic Marker Alpha',
  'Skills: Node.js',
  'Experience: Platform engineering',
].join('\n')
const TEXT_REORDERED = [
  'Experience: Platform engineering',
  'Synthetic Marker Alpha',
  'Skills: Node.js',
].join('\n')

function serializedReportForText(text = TEXT_A) {
  return JSON.stringify(buildSafeExtractionEquivalenceReport([
    { formatLabel: 'doc', extractionMethod: 'synthetic_doc', extractedText: text },
    { formatLabel: 'docx', extractionMethod: 'synthetic_docx', extractedText: TEXT_A },
    { formatLabel: 'pdf', extractionMethod: 'synthetic_pdf', extractedText: TEXT_A },
  ]))
}

test('extraction equivalence report does not serialize raw text, filenames, paths, emails, or phones', () => {
  const unsafeText = [
    'Synthetic Marker Alpha',
    'Contact: user@example.invalid',
    'Phone: 555-010-0000',
    'Path marker: /tmp/source-resume.docx',
    'Filename marker: source-resume.docx',
  ].join('\n')
  const serialized = serializedReportForText(unsafeText)

  assert.equal(serialized.includes('Synthetic Marker Alpha'), false)
  assert.equal(serialized.includes('user@example.invalid'), false)
  assert.equal(serialized.includes('555-010-0000'), false)
  assert.equal(serialized.includes('/tmp/source-resume.docx'), false)
  assert.equal(serialized.includes('source-resume.docx'), false)
})

test('extraction fingerprints are deterministic and ordered fingerprints distinguish reordered lines', () => {
  const first = buildSafeLineFingerprintSummary(TEXT_A)
  const second = buildSafeLineFingerprintSummary(TEXT_A)
  const reordered = buildSafeLineFingerprintSummary(TEXT_REORDERED)

  assert.equal(first.orderedNormalizedFingerprint, second.orderedNormalizedFingerprint)
  assert.notEqual(first.orderedNormalizedFingerprint, reordered.orderedNormalizedFingerprint)
})

test('sorted multiset and unique-line-set fingerprints preserve equality for reordered lines', () => {
  const first = buildSafeLineFingerprintSummary(TEXT_A)
  const reordered = buildSafeLineFingerprintSummary(TEXT_REORDERED)

  assert.equal(first.sortedLineMultisetFingerprint, reordered.sortedLineMultisetFingerprint)
  assert.equal(first.uniqueLineSetFingerprint, reordered.uniqueLineSetFingerprint)
})

test('unique-line-set fingerprint ignores duplicate normalized lines while multiset fingerprint detects them', () => {
  const base = buildSafeLineFingerprintSummary('Alpha\nBeta')
  const duplicated = buildSafeLineFingerprintSummary('Alpha\nBeta\nBeta')

  assert.equal(base.uniqueLineSetFingerprint, duplicated.uniqueLineSetFingerprint)
  assert.notEqual(base.sortedLineMultisetFingerprint, duplicated.sortedLineMultisetFingerprint)
})

test('aggregate only-in-format hash counts are reported without raw lines', () => {
  const summaries = {
    doc: buildSafeLineFingerprintSummary('shared\ndoc only'),
    docx: buildSafeLineFingerprintSummary('shared\ndocx only'),
    pdf: buildSafeLineFingerprintSummary('shared\npdf only'),
  }
  const counts = buildOnlyInFormatHashCounts(summaries)
  const report = buildSafeExtractionEquivalenceReport([
    { formatLabel: 'doc', extractionMethod: 'doc', extractedText: 'shared\ndoc only' },
    { formatLabel: 'docx', extractionMethod: 'docx', extractedText: 'shared\ndocx only' },
    { formatLabel: 'pdf', extractionMethod: 'pdf', extractedText: 'shared\npdf only' },
  ])

  assert.deepEqual(counts, {
    onlyInDocLineHashCount: 1,
    onlyInDocxLineHashCount: 1,
    onlyInPdfLineHashCount: 1,
  })
  assert.deepEqual(report.aggregateOnlyInFormatHashCounts, counts)
  assert.equal(JSON.stringify(report).includes('doc only'), false)
})

test('missing local fixture paths are rejected with a safe concise error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resume-diagnostic-'))
  try {
    await assert.rejects(
      () => runExtractionEquivalenceFromLocalFixtures({
        docPath: join(dir, 'missing-doc'),
        docxPath: join(dir, 'missing-docx'),
        pdfPath: join(dir, 'missing-pdf'),
      }),
      /missing_required_fixture_path/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
