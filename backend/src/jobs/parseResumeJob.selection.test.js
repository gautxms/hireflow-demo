import test from 'node:test'
import assert from 'node:assert/strict'

import { buildExtractionSelectionDiagnostics } from './parseResumeJob.js'

test('OCR low confidence + usable pdf_text keeps pdf_text selection diagnostics usable', () => {
  const result = buildExtractionSelectionDiagnostics({
    extractionResult: {
      rawText: 'Summary Experience Education Skills Projects JavaScript Node SQL '.repeat(4),
      methodUsed: 'pdf_text',
      ocrConfidence: 25,
      stageDiagnostics: {
        pdf_text: { attempted: true, extractedTextLength: 220, status: 'success' },
        ocr: { attempted: true, extractedTextLength: 180, confidence: 25, status: 'failed' },
        direct_pdf_vision: { attempted: false, status: 'skipped', reason: 'pdf_text_usable' },
      },
    },
    ocrOutcome: { failureCategory: 'image_only_low_ocr' },
    hasUsableExtractedText: true,
  })

  assert.equal(result.pdfTextAvailable, true)
  assert.equal(result.pdfTextQuality, 'usable_resume_signals')
  assert.equal(result.selectedExtractionMethod, 'pdf_text')
  assert.equal(result.aiCalled, false)
})

test('low confidence + unusable pdf_text + no direct fallback yields extraction terminal diagnostics shape', () => {
  const result = buildExtractionSelectionDiagnostics({
    extractionResult: {
      rawText: 'obj stream xref',
      methodUsed: 'failed',
      ocrConfidence: 12,
      stageDiagnostics: {
        pdf_text: { attempted: true, extractedTextLength: 14, status: 'failed' },
        ocr: { attempted: true, extractedTextLength: 20, confidence: 12, status: 'failed' },
        direct_pdf_vision: { attempted: false, status: 'skipped', reason: 'unsupported_model_input_mode' },
      },
    },
    ocrOutcome: { failureCategory: 'image_only_low_ocr' },
    hasUsableExtractedText: false,
  })

  assert.equal(result.pdfTextQuality, 'unusable')
  assert.equal(result.ocrUsable, false)
  assert.match(result.skippedReasons.join(','), /unsupported_model_input_mode/)
})

test('enough extracted text without section labels is warning-only quality, not unusable', () => {
  const result = buildExtractionSelectionDiagnostics({
    extractionResult: {
      rawText: 'John Doe Senior Software Engineer at Acme Corp built distributed systems and improved reliability by 42 percent '.repeat(3),
      methodUsed: 'pdf_text',
      stageDiagnostics: {
        pdf_text: { attempted: true, extractedTextLength: 300, status: 'success' },
        ocr: { attempted: false, extractedTextLength: 0, confidence: 0, status: 'skipped' },
        direct_pdf_vision: { attempted: false, status: 'skipped', reason: 'pdf_text_usable' },
      },
    },
    ocrOutcome: null,
    hasUsableExtractedText: true,
  })

  assert.equal(result.pdfTextQuality, 'missing_resume_signals')
  assert.equal(result.hasResumeSignals, false)
  assert.equal(result.terminalReason, null)
})
