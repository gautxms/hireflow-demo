import { Buffer } from 'node:buffer'
import process from 'node:process'
import crypto from 'crypto'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { pool } from '../db/client.js'
import { normalizeResumeFileMetadata } from '../utils/resumeFileMetadata.js'
import { enqueueParseJob } from './jobQueue.js'
import { isScanResultSafe, scanFileBuffer } from './virusScanService.js'
import { isAcceptedResumeUpload, resolveEffectiveMimeType } from '../utils/fileMime.js'

export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
let uploadTablesReady = false
const s3Bucket = process.env.AWS_S3_BUCKET
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
})

function toBuffer(streamOrBuffer) {
  if (Buffer.isBuffer(streamOrBuffer)) {
    return Promise.resolve(streamOrBuffer)
  }

  return new Promise((resolve, reject) => {
    const chunks = []

    streamOrBuffer.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    streamOrBuffer.on('end', () => resolve(Buffer.concat(chunks)))
    streamOrBuffer.on('error', reject)
  })
}

function ensureS3Configured() {
  if (!s3Bucket) {
    throw new Error('AWS_S3_BUCKET is required for chunk uploads')
  }
}

function normalizeMimeType(filename, mimeType) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
  return resolveEffectiveMimeType(normalizedMimeType, filename)
}

function resolveClientChunkSize(clientChunkSize) {
  if (clientChunkSize === undefined || clientChunkSize === null || clientChunkSize === '') {
    return CHUNK_SIZE_BYTES
  }

  const parsedChunkSize = Number(clientChunkSize)

  if (!Number.isFinite(parsedChunkSize) || !Number.isInteger(parsedChunkSize) || parsedChunkSize <= 0) {
    throw new Error('clientChunkSize must be a positive integer')
  }

  if (parsedChunkSize > CHUNK_SIZE_BYTES) {
    throw new Error('clientChunkSize exceeds 5MB limit')
  }

  return parsedChunkSize
}

async function ensureUploadChunkTables() {
  if (uploadTablesReady) {
    return
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS upload_chunks (
      upload_id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      file_size BIGINT NOT NULL CHECK (file_size > 0),
      mime_type TEXT,
      total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
      uploaded_chunks INTEGER[] NOT NULL DEFAULT '{}',
      s3_prefix TEXT NOT NULL,
      assembled_s3_key TEXT,
      assembled_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'completed', 'rejected', 'failed', 'expired')),
      scan_status TEXT,
      scan_result JSONB,
      resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
      parse_job_id TEXT,
      job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
      expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
      analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_upload_chunks_user_status
      ON upload_chunks (user_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_upload_chunks_expires_at
      ON upload_chunks (expires_at);

    ALTER TABLE resumes
      ADD COLUMN IF NOT EXISTS scan_status TEXT,
      ADD COLUMN IF NOT EXISTS scan_result JSONB,
      ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
      ADD COLUMN IF NOT EXISTS job_description_id UUID,
      ADD COLUMN IF NOT EXISTS original_filename TEXT,
      ADD COLUMN IF NOT EXISTS file_extension TEXT,
      ADD COLUMN IF NOT EXISTS original_mime_type TEXT;

    ALTER TABLE upload_chunks
      ADD COLUMN IF NOT EXISTS job_description_id UUID,
      ADD COLUMN IF NOT EXISTS analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;
  `)

  uploadTablesReady = true
}


async function ensureAnalysisTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      error_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      parse_job_id TEXT REFERENCES parse_jobs(job_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (analysis_id, resume_id)
    );
  `)
}

function buildPrefix(userId, uploadId) {
  return `users/${userId}/uploads/${uploadId}`
}

function resolveUploadPrefix(rowOrUploadId, fallbackUploadId = null) {
  if (rowOrUploadId && typeof rowOrUploadId === 'object') {
    const storedPrefix = String(rowOrUploadId.s3_prefix || '').trim()
    if (storedPrefix) {
      return storedPrefix
    }

    if (rowOrUploadId.user_id && rowOrUploadId.upload_id) {
      return buildPrefix(rowOrUploadId.user_id, rowOrUploadId.upload_id)
    }
  }

  if (fallbackUploadId) {
    return buildPrefix(rowOrUploadId, fallbackUploadId)
  }

  throw new Error('Upload S3 prefix is unavailable')
}

function buildChunkKeyFromPrefix(prefix, chunkIndex) {
  return `${prefix}/chunks/${chunkIndex}`
}

export function hasCompleteChunkSet(uploadedChunks, totalChunks) {
  if (!Array.isArray(uploadedChunks) || !Number.isInteger(totalChunks) || totalChunks <= 0) {
    return false
  }

  if (uploadedChunks.length !== totalChunks) {
    return false
  }

  const sorted = [...new Set(uploadedChunks.map((value) => Number(value)))].sort((a, b) => a - b)
  if (sorted.length !== totalChunks) {
    return false
  }

  for (let index = 0; index < totalChunks; index += 1) {
    if (sorted[index] !== index) {
      return false
    }
  }

  return true
}

export async function initChunkUpload({ userId, filename, fileSize, mimeType, jobDescriptionId = null, analysisId = null, analysisName = null, clientChunkSize = undefined }) {
  ensureS3Configured()
  await ensureUploadChunkTables()
  await ensureAnalysisTables()

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('Invalid file size')
  }

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds 100MB limit')
  }

  const effectiveChunkSize = resolveClientChunkSize(clientChunkSize)
  const totalChunks = Math.ceil(fileSize / effectiveChunkSize)
  const fileMetadata = normalizeResumeFileMetadata({ originalFilename: filename, reportedMimeType: mimeType })
  const originalFilename = fileMetadata.originalFilename
  const safeFilename = fileMetadata.storageFilename
  const normalizedMimeType = normalizeMimeType(originalFilename, fileMetadata.originalMimeType)

  if (!isAcceptedResumeUpload(normalizedMimeType, originalFilename)) {
    throw new Error('Only PDF, DOC, DOCX, and TXT files are allowed')
  }

  if (jobDescriptionId) {
    const jdResult = await pool.query(
      `SELECT id
       FROM job_descriptions
       WHERE id = $1
         AND user_id = $2
         AND status <> 'archived'
       LIMIT 1`,
      [jobDescriptionId, userId],
    )

    if (!jdResult.rows[0]) {
      throw new Error('Selected job description is invalid or archived')
    }
  }

  let resolvedAnalysisId = String(analysisId || '').trim()
  if (resolvedAnalysisId) {
    const analysisResult = await pool.query(
      `SELECT id
         FROM analyses
        WHERE id = $1
          AND user_id = $2
        LIMIT 1`,
      [resolvedAnalysisId, userId],
    )

    if (!analysisResult.rows[0]) {
      throw new Error('Invalid analysis context for upload')
    }
  } else {
    const createdAnalysis = await pool.query(
      `INSERT INTO analyses (user_id, job_description_id, status, name)
       VALUES ($1, $2, 'pending', NULLIF($3, ''))
       RETURNING id`,
      [userId, jobDescriptionId, String(analysisName || "").trim()],
    )
    resolvedAnalysisId = createdAnalysis.rows[0]?.id || ''
  }

  const existingResult = await pool.query(
    `SELECT upload_id, uploaded_chunks, total_chunks
     FROM upload_chunks
     WHERE user_id = $1
       AND filename = $2
       AND file_size = $3
       AND status = 'uploading'
       AND expires_at > NOW()
       AND analysis_id = $4
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, safeFilename, fileSize, resolvedAnalysisId],
  )

  if (existingResult.rows[0]) {
    return {
      uploadId: existingResult.rows[0].upload_id,
      totalChunks: Number(existingResult.rows[0].total_chunks),
      uploadedChunks: existingResult.rows[0].uploaded_chunks || [],
      resumed: true,
      analysisId: resolvedAnalysisId,
    }
  }

  const uploadId = crypto.randomUUID()
  const prefix = buildPrefix(userId, uploadId)

  await pool.query(
    `INSERT INTO upload_chunks
      (upload_id, user_id, filename, file_size, mime_type, total_chunks, uploaded_chunks, s3_prefix, status, job_description_id, analysis_id, expires_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7::int[], $8, 'uploading', $9, $10, NOW() + INTERVAL '24 hours')`,
    [uploadId, userId, safeFilename, fileSize, normalizedMimeType, totalChunks, [], prefix, jobDescriptionId, resolvedAnalysisId],
  )

  return {
    uploadId,
    totalChunks,
    uploadedChunks: [],
    resumed: false,
    analysisId: resolvedAnalysisId,
  }
}

export async function storeChunk({ userId, uploadId, chunkIndex, totalChunks, chunkBuffer }) {
  ensureS3Configured()

  const uploadResult = await pool.query(
    `SELECT upload_id, user_id, total_chunks, status, s3_prefix
     FROM upload_chunks
     WHERE upload_id = $1 AND user_id = $2
     LIMIT 1`,
    [uploadId, userId],
  )

  const uploadRow = uploadResult.rows[0]

  if (!uploadRow) {
    throw new Error('Upload session not found')
  }

  if (uploadRow.status !== 'uploading') {
    throw new Error('Upload session is not accepting new chunks')
  }

  if (Number(uploadRow.total_chunks) !== Number(totalChunks)) {
    throw new Error('Chunk metadata mismatch')
  }

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= Number(totalChunks)) {
    throw new Error('chunkIndex is out of range')
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: buildChunkKeyFromPrefix(resolveUploadPrefix(uploadRow), chunkIndex),
    Body: chunkBuffer,
    ContentType: 'application/octet-stream',
  }))

  await pool.query(
    `UPDATE upload_chunks
     SET uploaded_chunks = ARRAY(
           SELECT DISTINCT value
           FROM unnest(uploaded_chunks || $1::int) AS value
           ORDER BY value
         ),
         updated_at = NOW()
     WHERE upload_id = $2`,
    [chunkIndex, uploadId],
  )
}

export async function getChunkUploadStatus({ userId, uploadId }) {
  const result = await pool.query(
    `SELECT upload_id, total_chunks, uploaded_chunks, filename, file_size, status
     FROM upload_chunks
     WHERE upload_id = $1 AND user_id = $2
     LIMIT 1`,
    [uploadId, userId],
  )

  const row = result.rows[0]

  if (!row) {
    return null
  }

  return {
    uploadId: row.upload_id,
    totalChunks: Number(row.total_chunks),
    uploadedChunks: row.uploaded_chunks || [],
    filename: row.filename,
    fileSize: Number(row.file_size),
    status: row.status,
  }
}

export async function completeChunkUpload({ userId, uploadId }) {
  ensureS3Configured()

  const result = await pool.query(
    `SELECT upload_id, user_id, filename, mime_type, file_size, total_chunks, uploaded_chunks, status, job_description_id, resume_id, analysis_id, s3_prefix
     FROM upload_chunks
     WHERE upload_id = $1 AND user_id = $2
     LIMIT 1`,
    [uploadId, userId],
  )

  const row = result.rows[0]

  if (!row) {
    throw new Error('Upload session not found')
  }

  if (row.status !== 'uploading') {
    throw new Error('Upload session is already finalized')
  }

  const totalChunks = Number(row.total_chunks)
  const uploadedChunks = row.uploaded_chunks || []

  if (!hasCompleteChunkSet(uploadedChunks, totalChunks)) {
    throw new Error('Upload is incomplete. Missing chunks detected.')
  }

  const chunkBuffers = []

  for (let index = 0; index < totalChunks; index += 1) {
    const chunkObject = await s3Client.send(new GetObjectCommand({
      Bucket: s3Bucket,
      Key: buildChunkKeyFromPrefix(resolveUploadPrefix(row), index),
    }))

    chunkBuffers.push(await toBuffer(chunkObject.Body))
  }

  const assembledBuffer = Buffer.concat(chunkBuffers)
  if (assembledBuffer.length !== Number(row.file_size)) {
    await pool.query(
      `UPDATE upload_chunks
       SET status = 'failed',
           updated_at = NOW()
       WHERE upload_id = $1`,
      [uploadId],
    )
    throw new Error('Upload assembly failed: reconstructed file size mismatch')
  }

  const fileMetadata = normalizeResumeFileMetadata({ originalFilename: row.filename, reportedMimeType: row.mime_type })
  const assembledHash = crypto.createHash('sha256').update(assembledBuffer).digest('hex')
  const uploadPrefix = resolveUploadPrefix(row)
  const assembledKey = `${uploadPrefix}/assembled/${fileMetadata.storageFilename}`
  const normalizedMimeType = normalizeMimeType(fileMetadata.storageFilename, fileMetadata.originalMimeType)

  await s3Client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: assembledKey,
    Body: assembledBuffer,
    ContentType: normalizedMimeType || 'application/octet-stream',
  }))

  const scanResult = await scanFileBuffer(assembledBuffer, row.filename)

  if (!isScanResultSafe(scanResult)) {
    await pool.query(
      `UPDATE upload_chunks
       SET status = 'rejected',
           scan_status = $2,
           scan_result = $3::jsonb,
           assembled_sha256 = $4,
           updated_at = NOW()
       WHERE upload_id = $1`,
      [uploadId, scanResult.status || 'error', JSON.stringify(scanResult), assembledHash],
    )

    const reason = scanResult.malicious
      ? 'malware detected in file scan'
      : `file scan returned ${scanResult.status || 'unknown'}`
    throw new Error(`Upload rejected: ${reason}`)
  }

  const client = await pool.connect()
  let resumeId = row.resume_id || null
  let finalizedUpload = null
  try {
    await client.query('BEGIN')
    const freshStatus = await client.query(
      `SELECT status, resume_id, parse_job_id
       FROM upload_chunks
       WHERE upload_id = $1
       FOR UPDATE`,
      [uploadId],
    )
    const current = freshStatus.rows[0]
    if (!current || current.status !== 'uploading') {
      throw new Error('Upload session is already finalized')
    }

    if (!resumeId) {
      const resumeInsertResult = await client.query(
        `INSERT INTO resumes (user_id, filename, raw_text, file_size, file_type, parse_status, job_description_id, original_filename, file_extension, original_mime_type, updated_at)
         VALUES ($1, $2, '', $3, $4, 'pending', $5, $6, $7, $8, NOW())
         RETURNING id`,
        [
          userId,
          row.filename,
          row.file_size,
          normalizedMimeType,
          row.job_description_id,
          row.filename,
          fileMetadata.fileExtension || null,
          row.mime_type || null,
        ],
      )
      resumeId = resumeInsertResult.rows[0].id
    }

    await client.query(
      `UPDATE upload_chunks
       SET status = 'completed',
           scan_status = $2,
           scan_result = $3::jsonb,
           assembled_s3_key = $4,
           assembled_sha256 = $5,
           resume_id = $6,
           parse_job_id = NULL,
           updated_at = NOW()
       WHERE upload_id = $1`,
      [
        uploadId,
        scanResult.status || 'clean',
        JSON.stringify(scanResult),
        assembledKey,
        assembledHash,
        resumeId,
      ],
    )
    await client.query('COMMIT')
    finalizedUpload = {
      resumeId,
      scan: scanResult,
      sha256: assembledHash,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const parseJob = await enqueueParseJob({
    resumeId: finalizedUpload.resumeId,
    userId,
    filename: row.filename,
    originalFilename: row.filename,
    originalMimeType: row.mime_type || null,
    fileExtension: fileMetadata.fileExtension || null,
    mimeType: normalizedMimeType,
    fileSize: row.file_size,
    fileBufferBase64: assembledBuffer.toString('base64'),
    analysisId: row.analysis_id || null,
    jobDescriptionId: row.job_description_id,
  })

  await pool.query(
    `UPDATE upload_chunks
     SET parse_job_id = $2,
         updated_at = NOW()
     WHERE upload_id = $1`,
    [uploadId, String(parseJob.id)],
  )

  if (row.analysis_id) {
    await pool.query(
      `INSERT INTO analysis_items (analysis_id, resume_id, parse_job_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (analysis_id, resume_id)
       DO UPDATE SET parse_job_id = EXCLUDED.parse_job_id`,
      [row.analysis_id, finalizedUpload.resumeId, String(parseJob.id)],
    )
  }

  await deleteChunkObjects(uploadPrefix, totalChunks)

  return {
    ok: true,
    uploadId,
    resumeId: finalizedUpload.resumeId,
    jobId: String(parseJob.id),
    filename: fileMetadata.storageFilename,
    originalFilename: fileMetadata.originalFilename,
    fileExtension: fileMetadata.fileExtension || null,
    mimeType: normalizedMimeType,
    originalMimeType: fileMetadata.originalMimeType,
    scan: finalizedUpload.scan,
    sha256: finalizedUpload.sha256,
    analysisId: row.analysis_id || null,
  }
}

async function deleteChunkObjects(prefix, totalChunks) {
  const toDelete = []

  for (let index = 0; index < totalChunks; index += 1) {
    toDelete.push({ Key: buildChunkKeyFromPrefix(prefix, index) })
  }

  if (toDelete.length === 1) {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: toDelete[0].Key,
    }))
    return
  }

  if (toDelete.length > 1) {
    await s3Client.send(new DeleteObjectsCommand({
      Bucket: s3Bucket,
      Delete: {
        Objects: toDelete,
      },
    }))
  }
}

async function deletePrefix(prefix) {
  const listed = await s3Client.send(new ListObjectsV2Command({
    Bucket: s3Bucket,
    Prefix: prefix,
  }))

  const objects = listed.Contents || []

  if (objects.length === 0) {
    return
  }

  await s3Client.send(new DeleteObjectsCommand({
    Bucket: s3Bucket,
    Delete: {
      Objects: objects.map((obj) => ({ Key: obj.Key })),
    },
  }))
}

export async function cleanupExpiredChunkUploads() {
  ensureS3Configured()
  await ensureUploadChunkTables()
  await ensureAnalysisTables()

  const result = await pool.query(
    `SELECT upload_id, s3_prefix
     FROM upload_chunks
     WHERE status = 'uploading'
       AND expires_at < NOW()
     LIMIT 100`,
  )

  const expiredUploadIds = []

  for (const row of result.rows) {
    try {
      await deletePrefix(resolveUploadPrefix(row))
      expiredUploadIds.push(row.upload_id)
    } catch (error) {
      console.error('[ChunkUpload] Cleanup failed for upload', row.upload_id, error)
    }
  }

  if (expiredUploadIds.length > 0) {
    await pool.query(
      `UPDATE upload_chunks
       SET status = 'expired',
           updated_at = NOW()
       WHERE upload_id = ANY($1::uuid[])`,
      [expiredUploadIds],
    )
  }

  return result.rowCount
}

export function startChunkUploadCleanupCron() {
  setInterval(() => {
    cleanupExpiredChunkUploads()
      .then((count) => {
        if (count > 0) {
          console.log(`[ChunkUpload] Cleaned up ${count} expired upload session(s)`)
        }
      })
      .catch((error) => {
        console.error('[ChunkUpload] Cleanup cron failed:', error)
      })
  }, CLEANUP_INTERVAL_MS)
}
