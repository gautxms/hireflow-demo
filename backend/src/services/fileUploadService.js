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
import { scanFileBuffer } from './virusScanService.js'

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
      ADD COLUMN IF NOT EXISTS file_sha256 TEXT;
  `)

  uploadTablesReady = true
}

function buildPrefix(uploadId) {
  return `uploads/${uploadId}`
}

function buildChunkKey(uploadId, chunkIndex) {
  return `${buildPrefix(uploadId)}/chunks/${chunkIndex}`
}

export async function initChunkUpload({ userId, filename, fileSize, mimeType }) {
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
      (upload_id, user_id, filename, file_size, mime_type, total_chunks, uploaded_chunks, s3_prefix, status, expires_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7::int[], $8, 'uploading', NOW() + INTERVAL '24 hours')`,
    [uploadId, userId, safeFilename, fileSize, mimeType, totalChunks, [], prefix],
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
    `SELECT upload_id, filename, mime_type, file_size, total_chunks, uploaded_chunks, status
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

  if (uploadedChunks.length !== totalChunks) {
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
  const assembledHash = crypto.createHash('sha256').update(assembledBuffer).digest('hex')
  const assembledKey = `${buildPrefix(uploadId)}/assembled/${row.filename}`

  await s3Client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: assembledKey,
    Body: assembledBuffer,
    ContentType: row.mime_type || 'application/octet-stream',
  }))

  const scanResult = await scanFileBuffer(assembledBuffer, row.filename)

  if (scanResult.malicious) {
    await pool.query(
      `UPDATE upload_chunks
       SET status = 'rejected',
           scan_status = 'malicious',
           scan_result = $2::jsonb,
           assembled_sha256 = $3,
           updated_at = NOW()
       WHERE upload_id = $1`,
      [uploadId, JSON.stringify(scanResult), assembledHash],
    )

    throw new Error('Upload rejected: malware detected in file scan')
  }

  const resumeInsertResult = await pool.query(
    `INSERT INTO resumes (user_id, filename, raw_text, file_size, file_type, parse_status, updated_at)
     VALUES ($1, $2, '', $3, $4, 'pending', NOW())
     RETURNING id`,
    [userId, row.filename, row.file_size, row.mime_type],
  )

  const resumeId = resumeInsertResult.rows[0].id

  const parseJob = await enqueueParseJob({
    resumeId,
    userId,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    fileBufferBase64: assembledBuffer.toString('base64'),
  })

  await pool.query(
    `UPDATE upload_chunks
     SET status = 'completed',
         scan_status = $2,
         scan_result = $3::jsonb,
         assembled_s3_key = $4,
         assembled_sha256 = $5,
         resume_id = $6,
         parse_job_id = $7,
         updated_at = NOW()
     WHERE upload_id = $1`,
    [
      uploadId,
      scanResult.status || 'clean',
      JSON.stringify(scanResult),
      assembledKey,
      assembledHash,
      resumeId,
      String(parseJob.id),
    ],
  )

  await deleteChunkObjects(uploadId, totalChunks)

  return {
    ok: true,
    uploadId,
    resumeId,
    jobId: String(parseJob.id),
    scan: scanResult,
    sha256: assembledHash,
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

  for (const row of result.rows) {
    try {
      await deletePrefix(row.s3_prefix || buildPrefix(row.upload_id))

      await pool.query(
        `UPDATE upload_chunks
         SET status = 'expired',
             updated_at = NOW()
         WHERE upload_id = $1`,
        [row.upload_id],
      )
    } catch (error) {
      console.error('[ChunkUpload] Cleanup failed for upload', row.upload_id, error)
    }
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
