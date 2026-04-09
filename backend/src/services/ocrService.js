import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const OCR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ocrCache = new Map()

function cleanupExpiredCache() {
  const now = Date.now()

  for (const [key, entry] of ocrCache.entries()) {
    if (entry.expiresAt <= now) {
      ocrCache.delete(key)
    }
  }
}

export function estimateExtractableText(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return { text: '', ratio: 0, length: 0 }
  }

  const raw = fileBuffer.toString('latin1')
  const printableRuns = raw.match(/[A-Za-z0-9@:/._?&=#,.;|+'"%()\-\s]{4,}/g) || []
  const text = printableRuns.join(' ').replace(/[ \t]+/g, ' ').trim()
  const ratio = Math.min(1, text.length / Math.max(1, fileBuffer.length))

  return {
    text,
    ratio,
    length: text.length,
  }
}

export function isLikelyScannedPdf({ mimeType, fileBuffer }) {
  if (mimeType !== 'application/pdf') {
    return false
  }

  const extraction = estimateExtractableText(fileBuffer)
  return extraction.ratio < 0.1
}

function getCacheKey(fileBuffer) {
  return createHash('sha256').update(fileBuffer).digest('hex')
}

export async function runOcrWithCache({ fileBuffer, mimeType }) {
  cleanupExpiredCache()

  const cacheKey = getCacheKey(fileBuffer)
  const cached = ocrCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.payload,
      cacheHit: true,
    }
  }

  const payload = await runOcr({ fileBuffer, mimeType })

  ocrCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + OCR_CACHE_TTL_MS,
  })

  return {
    ...payload,
    cacheHit: false,
  }
}

export async function runOcr({ fileBuffer, mimeType }) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('OCR input file is empty')
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hireflow-ocr-'))
  const ext = mimeType === 'application/pdf' ? 'pdf' : 'bin'
  const inputPath = path.join(tmpDir, `resume.${ext}`)

  try {
    await fs.writeFile(inputPath, fileBuffer)

    const { stdout } = await execFileAsync('tesseract', [inputPath, 'stdout'], {
      timeout: 120_000,
      maxBuffer: 25 * 1024 * 1024,
    })

    const text = String(stdout || '').replace(/\s+/g, ' ').trim()
    const confidence = Math.max(40, Math.min(95, Math.round((text.length / Math.max(1, fileBuffer.length * 0.02)) * 100)))

    return {
      text,
      confidence,
      provider: 'tesseract-cli',
      method: 'ocr',
      createdAt: new Date().toISOString(),
    }
  } catch (error) {
    const fallbackExtraction = estimateExtractableText(fileBuffer)

    if (fallbackExtraction.length === 0) {
      throw new Error(`OCR failed: ${error.message || 'Unknown OCR error'}`)
    }

    return {
      text: fallbackExtraction.text,
      confidence: 45,
      provider: 'heuristic-fallback',
      method: 'ocr',
      createdAt: new Date().toISOString(),
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}
