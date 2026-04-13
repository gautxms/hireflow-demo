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
import { sanitizeFilename } from '../utils/sanitize.js'
import { enqueueParseJob } from './jobQueue.js'
import { isScanResultSafe, scanFileBuffer } from './virusScanService.js'

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
      ADD COLUMN IF NOT EXISTS job_description_id UUID;

    ALTER TABLE upload_chunks
      ADD COLUMN IF NOT EXISTS job_description_id UUID;
  `)

  uploadTablesReady = true
}

function buildPrefix(uploadId) {
  return `uploads/${uploadId}`
}

function buildChunkKey(uploadId, chunkIndex) {
  return `${buildPrefix(uploadId)}/chunks/${chunkIndex}`
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

export async function initChunkUpload({ userId, filename, fileSize, mimeType, jobDescriptionId = null }) {
  ensureS3Configured()
  await ensureUploadChunkTables()

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('Invalid file size')
  }

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds 100MB limit')
  }

  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE_BYTES)
  const safeFilename = sanitizeFilename(filename)

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

  const existingResult = await pool.query(
    `SELECT upload_id, uploaded_chunks, total_chunks
     FROM upload_chunks
     WHERE user_id = $1
       AND filename = $2
       AND file_size = $3
       AND status = 'uploading'
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, safeFilename, fileSize],
  )

  if (existingResult.rows[0]) {
    return {
      uploadId: existingResult.rows[0].upload_id,
      totalChunks: Number(existingResult.rows[0].total_chunks),
      uploadedChunks: existingResult.rows[0].uploaded_chunks || [],
      resumed: true,
    }
  }

  const uploadId = crypto.randomUUID()
  const prefix = buildPrefix(uploadId)

  await pool.query(
    `INSERT INTO upload_chunks
      (upload_id, user_id, filename, file_size, mime_type, total_chunks, uploaded_chunks, s3_prefix, status, job_description_id, expires_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7::int[], $8, 'uploading', $9, NOW() + INTERVAL '24 hours')`,
    [uploadId, userId, safeFilename, fileSize, mimeType, totalChunks, [], prefix, jobDescriptionId],
  )

  return {
    uploadId,
    totalChunks,
    uploadedChunks: [],
    resumed: false,
  }
}

export async function storeChunk({ userId, uploadId, chunkIndex, totalChunks, chunkBuffer }) {
  ensureS3Configured()

  const uploadResult = await pool.query(
    `SELECT upload_id, total_chunks, status
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
    Key: buildChunkKey(uploadId, chunkIndex),
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
    `SELECT upload_id, filename, mime_type, file_size, total_chunks, uploaded_chunks, status, job_description_id, resume_id
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
      Key: buildChunkKey(uploadId, index),
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

  const assembledHash = crypto.createHash('sha256').update(assembledBuffer).digest('hex')
  const assembledKey = `${buildPrefix(uploadId)}/assembled/${row.filename}`

  await s3Client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: assembledKey,
    Body: assembledBuffer,
    ContentType: row.mime_type || 'application/octet-stream',
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
        `INSERT INTO resumes (user_id, filename, raw_text, file_size, file_type, parse_status, job_description_id, updated_at)
         VALUES ($1, $2, '', $3, $4, 'pending', $5, NOW())
         RETURNING id`,
        [userId, row.filename, row.file_size, row.mime_type, row.job_description_id],
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
    mimeType: row.mime_type,
    fileSize: row.file_size,
    fileBufferBase64: assembledBuffer.toString('base64'),
    jobDescriptionId: row.job_description_id,
  })

  await pool.query(
    `UPDATE upload_chunks
     SET parse_job_id = $2,
         updated_at = NOW()
     WHERE upload_id = $1`,
    [uploadId, String(parseJob.id)],
  )

  await deleteChunkObjects(uploadId, totalChunks)

  return {
    ok: true,
    uploadId,
    resumeId: finalizedUpload.resumeId,
    jobId: String(parseJob.id),
    scan: finalizedUpload.scan,
    sha256: finalizedUpload.sha256,
  }
}

async function deleteChunkObjects(uploadId, totalChunks) {
  const toDelete = []

  for (let index = 0; index < totalChunks; index += 1) {
    toDelete.push({ Key: buildChunkKey(uploadId, index) })
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
      await deletePrefix(row.s3_prefix || buildPrefix(row.upload_id))
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
