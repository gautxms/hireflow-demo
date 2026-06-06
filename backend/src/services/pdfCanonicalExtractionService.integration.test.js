import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeResumeWithConfiguredFallback } from './aiResumeAnalysisService.js'
import { observePdfCanonicalTextExtraction } from './pdfCanonicalExtractionService.js'
import { buildResumeTextFingerprint } from './resumeTextFingerprint.js'
import {
  SYNTHETIC_CANONICAL_RESUME_TEXT,
  buildMissingTextPdfFixture,
  buildSyntheticPdfResumeFixture,
} from './resumeFormatDiagnosticFixtures.js'

function isExplicitlyEnabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase())
}

async function requireRealPdfJs(t) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    assert.equal(typeof pdfjs.getDocument, 'function')
    return pdfjs
  } catch (error) {
    const message = `pdfjs-dist production import unavailable: ${String(error?.code || error?.message || error)}`
    if (isExplicitlyEnabled(process.env.ALLOW_PDFJS_INTEGRATION_TEST_SKIP)) {
      t.skip(message)
      return null
    }

    throw new Error(message, { cause: error })
  }
}

test('real pdfjs-dist observe-only extraction parses compressed PDF and does not alter AI provider payload', async (t) => {
  const pdfjs = await requireRealPdfJs(t)
  if (!pdfjs) return
  const previousFlag = process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED
  process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = 'true'
  try {
    const fixture = buildSyntheticPdfResumeFixture()
    assert.equal(fixture.buffer.includes(Buffer.from('/FlateDecode')), true)
    assert.equal(fixture.buffer.includes(Buffer.from('Synthetic Candidate Alpha')), false)

    const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer)
    const canonicalFingerprint = buildResumeTextFingerprint(SYNTHETIC_CANONICAL_RESUME_TEXT)

    assert.equal(diagnostic.success, true)
    assert.equal(diagnostic.qualityClassification, 'usable_text_extraction')
    assert.equal(diagnostic.safeSectionMarkerCoverage.found >= 4, true)
    assert.match(diagnostic.normalizedFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(diagnostic.normalizedFingerprint, canonicalFingerprint.sha256)

    const credentials = {
      activeProvider: 'anthropic',
      providers: {
        anthropic: {
          primary: { apiKey: 'anth-key', model: 'claude-sonnet-4', source: 'admin' },
        },
      },
      governance: { aiEnabled: true, workflowToggles: { resumeAnalysisEnabled: true } },
    }
    const calls = []
    await analyzeResumeWithConfiguredFallback(fixture.buffer.toString('base64'), 'application/pdf', 'resume.pdf', {
      credentials,
      systemPromptConfig: { systemPrompt: 'Base prompt', promptVersion: 2, isDefaultFallback: false },
      analyzeWithAnthropic: async (fileB64, mimeType, filename) => {
        calls.push({ fileB64, mimeType, filename })
        return {
          result: { candidates: [{ id: 'cand-pdf' }] },
          provider: 'anthropic-primary',
          model: 'claude-sonnet-4',
          tokenUsage: { usageAvailable: false, unavailableReason: 'not_collected' },
        }
      },
      analyzeWithOpenAI: async () => {
        throw new Error('openai should not be called')
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].fileB64, fixture.buffer.toString('base64'))
    assert.equal(calls[0].mimeType, 'application/pdf')
    assert.equal(calls[0].filename, 'resume.pdf')
  } finally {
    if (previousFlag === undefined) delete process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED
    else process.env.PDF_CANONICAL_EXTRACTION_OBSERVE_ONLY_ENABLED = previousFlag
  }
})

test('real pdfjs-dist observe-only extraction classifies missing-text PDF when dependency is installed', async (t) => {
  const pdfjs = await requireRealPdfJs(t)
  if (!pdfjs) return
  const fixture = buildMissingTextPdfFixture()
  const diagnostic = await observePdfCanonicalTextExtraction(fixture.buffer)

  assert.equal(diagnostic.success, true)
  assert.equal(diagnostic.qualityClassification, 'likely_scanned_pdf')
  assert.equal(diagnostic.ocrRequired, true)
  assert.equal(diagnostic.normalizedFingerprint, null)
})
