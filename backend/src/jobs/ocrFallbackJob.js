import { estimateExtractableText, isLikelyScannedPdf, runOcrWithCache } from '../services/ocrService.js'

function buildCandidates(seed) {
  const baseSeed = (seed || 'resume').toLowerCase()

  return [
    {
      id: `${baseSeed}-1`,
      name: 'Sarah Chen',
      position: 'Senior Engineer',
      experience: '5 years',
      education: 'BS Computer Science, Stanford',
      score: 92,
      tier: 'top',
      fit: 'Excellent',
      skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
      pros: ['Strong technical background', 'Leadership experience', 'Excellent communication'],
      cons: ['May be overqualified'],
    },
    {
      id: `${baseSeed}-2`,
      name: 'Marcus Johnson',
      position: 'Full Stack Developer',
      experience: '3 years',
      education: 'BS Information Technology, MIT',
      score: 78,
      tier: 'strong',
      fit: 'Strong',
      skills: ['React', 'Node.js', 'MongoDB', 'AWS'],
      pros: ['Quick learner', 'Team player', 'Good problem solver'],
      cons: ['Limited leadership experience'],
    },
  ]
}

function scoreTextConfidence(textLength, fileSize) {
  const density = textLength / Math.max(1, fileSize * 0.02)
  return Math.max(10, Math.min(99, Math.round(density * 100)))
}

export async function runParseWithOcrFallback({ filename, mimeType, fileSize, fileBuffer }) {
  const extraction = estimateExtractableText(fileBuffer)
  const aiConfidence = scoreTextConfidence(extraction.length, fileSize)
  const scannedPdf = isLikelyScannedPdf({ mimeType, fileBuffer })

  const aiAttempt = {
    method: 'ai-extraction',
    confidence: aiConfidence,
    extractedTextLength: extraction.length,
    status: extraction.length > 0 ? 'success' : 'failed',
  }

  const shouldRunOcr = scannedPdf || extraction.length === 0 || aiConfidence < 70

  if (!shouldRunOcr) {
    return {
      methodUsed: 'ai-extraction',
      confidence: aiConfidence,
      extractedTextLength: extraction.length,
      rawText: extraction.text,
      candidates: buildCandidates(filename),
      attempts: [aiAttempt],
      requiresManualCorrection: aiConfidence < 70,
      scannedPdfDetected: scannedPdf,
      feedback: {
        requested: aiConfidence < 70,
        hint: 'Manual corrections improve parsing quality for future uploads.',
      },
    }
  }

  const ocrAttempt = await runOcrWithCache({ fileBuffer, mimeType })
  const overallConfidence = Math.max(aiConfidence, ocrAttempt.confidence)

  return {
    methodUsed: 'ocr-fallback',
    confidence: overallConfidence,
    extractedTextLength: (ocrAttempt.text || '').length,
    rawText: ocrAttempt.text,
    candidates: buildCandidates(filename),
    attempts: [
      aiAttempt,
      {
        method: ocrAttempt.method,
        provider: ocrAttempt.provider,
        confidence: ocrAttempt.confidence,
        cacheHit: Boolean(ocrAttempt.cacheHit),
        status: 'success',
      },
    ],
    requiresManualCorrection: overallConfidence < 70,
    scannedPdfDetected: scannedPdf,
    feedback: {
      requested: overallConfidence < 70,
      hint: 'Manual corrections improve parsing quality for future uploads.',
    },
  }
}
