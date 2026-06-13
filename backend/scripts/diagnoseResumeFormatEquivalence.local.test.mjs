import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

import {
  assertSemanticDocDiagnosticEnv,
  buildOnlyInFormatHashCounts,
  buildSafeExtractionEquivalenceReport,
  buildSafeLineFingerprintSummary,
  isDirectExecution,
  runExtractionEquivalenceFromLocalFixtures,
} from './diagnoseResumeFormatEquivalence.local.mjs'
import {
  __resetMammothClientForTests,
  __setMammothClientForTests,
} from '../src/services/resumeDocumentExtractionService.js'
import {
  __resetLegacyDocSemanticExtractorForTests,
  __setLegacyDocSemanticExtractorForTests,
} from '../src/services/legacyDocSemanticExtractionService.js'
import {
  buildSyntheticDocxResumeFixture,
  buildSyntheticPdfResumeFixture,
} from '../src/services/resumeFormatDiagnosticFixtures.js'

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
const SEMANTIC_TEXT = [
  'Semantic diagnostic summary with enough backend platform detail for scoring.',
  'Experience includes recruiting workflow automation, APIs, testing, and observability.',
  'Skills include Node.js, PostgreSQL, REST APIs, reliability, and production support.',
].join('\n')
const LEGACY_TEXT = 'Legacy fallback text that must not be selected by this diagnostic.'
const SEMANTIC_ENV = {
  ENABLE_LEGACY_DOC_EXTRACTION: 'true',
  LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ENABLED: 'true',
  LEGACY_DOC_SEMANTIC_TEXT_SCORING_EXPERIMENT_ALLOWED_USER_IDS: 'local-diagnostic-user',
}

function buildOleDocBuffer(text = LEGACY_TEXT) {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from(text, 'utf16le'),
  ])
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides)
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
      __resetMammothClientForTests()
      __resetLegacyDocSemanticExtractorForTests()
    })
}

async function writeEquivalenceFixtures(dir) {
  const docPath = join(dir, 'fixture.doc')
  const docxPath = join(dir, 'fixture.docx')
  const pdfPath = join(dir, 'fixture.pdf')
  const docx = await buildSyntheticDocxResumeFixture({ text: SEMANTIC_TEXT })
  const pdf = buildSyntheticPdfResumeFixture({ text: SEMANTIC_TEXT })
  await writeFile(docPath, buildOleDocBuffer())
  await writeFile(docxPath, docx.buffer)
  await writeFile(pdfPath, pdf.buffer)
  return { docPath, docxPath, pdfPath }
}

function serializedReportForText(text = TEXT_A) {
  return JSON.stringify(buildSafeExtractionEquivalenceReport([
    { formatLabel: 'doc', extractionMethod: 'synthetic_doc', extractedText: text },
    { formatLabel: 'docx', extractionMethod: 'synthetic_docx', extractedText: TEXT_A },
    { formatLabel: 'pdf', extractionMethod: 'synthetic_pdf', extractedText: TEXT_A },
  ]))
}

test('semantic DOC scoring selection succeeds when synthetic allowlist env is configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resume-diagnostic-'))
  try {
    await withEnv(SEMANTIC_ENV, async () => {
      __setLegacyDocSemanticExtractorForTests({
        async extract() {
          return { getBody: () => SEMANTIC_TEXT }
        },
      })
      __setMammothClientForTests({ extractRawText: async () => ({ value: SEMANTIC_TEXT }) })
      const paths = await writeEquivalenceFixtures(dir)
      const report = await runExtractionEquivalenceFromLocalFixtures(paths)
      const doc = report.formats.find((format) => format.formatLabel === 'doc')

      assert.equal(doc.extractionMethod, 'legacy_doc_word_extractor_semantic_text_scoring_experiment')
      assert.ok(doc.extractionStageMetrics.orderedNormalizedFingerprint)
      assert.ok(doc.promptReadyStageMetrics.orderedNormalizedFingerprint)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('harness safely fails when semantic DOC scoring is disabled or not allowlisted', async () => {
  assert.throws(() => assertSemanticDocDiagnosticEnv({}), /semantic_doc_scoring_not_selected/)

  const dir = await mkdtemp(join(tmpdir(), 'resume-diagnostic-'))
  try {
    await withEnv({ ENABLE_LEGACY_DOC_EXTRACTION: 'true' }, async () => {
      const paths = await writeEquivalenceFixtures(dir)
      await assert.rejects(() => runExtractionEquivalenceFromLocalFixtures(paths), (error) => {
        assert.equal(error.message, 'semantic_doc_scoring_not_selected')
        assert.equal(error.safeFallbackReason, 'local_semantic_doc_env_not_configured')
        return true
      })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('extraction equivalence report includes extraction and prompt-ready metric groups without raw text', () => {
  const report = buildSafeExtractionEquivalenceReport([
    { formatLabel: 'doc', extractionMethod: 'synthetic_doc', extractedText: `${TEXT_A}\n${TEXT_A}` },
    { formatLabel: 'docx', extractionMethod: 'synthetic_docx', extractedText: TEXT_A },
    { formatLabel: 'pdf', extractionMethod: 'synthetic_pdf', extractedText: TEXT_A },
  ])
  const [doc] = report.formats
  const serialized = JSON.stringify(report)

  assert.ok(doc.extractionStageMetrics)
  assert.ok(doc.promptReadyStageMetrics)
  assert.equal(serialized.includes('Synthetic Marker Alpha'), false)
  assert.equal(serialized.includes('Experience: Platform engineering'), false)
})

test('extraction equivalence report does not serialize filenames, paths, emails, phones, or base64 content', () => {
  const unsafeText = [
    'Synthetic Marker Alpha',
    'Contact: user@example.invalid',
    'Phone: 555-010-0000',
    'Path marker: /tmp/source-resume.docx',
    'Filename marker: source-resume.docx',
    'Base64 marker: U3ludGhldGljIE1hcmtlciBBbHBoYQ==',
  ].join('\n')
  const serialized = serializedReportForText(unsafeText)

  assert.equal(serialized.includes('Synthetic Marker Alpha'), false)
  assert.equal(serialized.includes('user@example.invalid'), false)
  assert.equal(serialized.includes('555-010-0000'), false)
  assert.equal(serialized.includes('/tmp/source-resume.docx'), false)
  assert.equal(serialized.includes('source-resume.docx'), false)
  assert.equal(serialized.includes('U3ludGhldGljIE1hcmtlciBBbHBoYQ=='), false)
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
        env: SEMANTIC_ENV,
      }),
      /missing_required_fixture_path/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Windows-safe direct execution helper and CLI invocation are covered', () => {
  assert.equal(isDirectExecution(), false)
  const result = spawnSync(process.execPath, ['backend/scripts/diagnoseResumeFormatEquivalence.local.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...SEMANTIC_ENV },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing_required_fixture_path/)
})
