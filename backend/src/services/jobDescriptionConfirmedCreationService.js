import crypto from 'node:crypto'
import process from 'node:process'
import { createJobDescription } from './jobDescriptionService.js'
import {
  issueJobDescriptionPreviewReceipt,
  JobDescriptionPreviewReceiptError,
  verifyJobDescriptionPreviewReceipt,
} from './jobDescriptionPreviewReceiptService.js'

export class JobDescriptionConfirmedCreationError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'JobDescriptionConfirmedCreationError'
    this.code = code
    this.status = status
  }
}

const PREVIEW_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

function resolveSigningSecret(explicitSecret) {
  const secret = explicitSecret
    || process.env.JOB_DESCRIPTION_PREVIEW_SIGNING_SECRET
    || process.env.JWT_SECRET

  if (!secret) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_SIGNING_UNAVAILABLE',
      'Job description confirmation is temporarily unavailable.',
      503,
    )
  }
  return secret
}

async function storeWithDefaultService(args) {
  const { storeJobDescriptionFile } = await import('./jobDescriptionFileStorageService.js')
  return storeJobDescriptionFile(args)
}

async function previewWithDefaultService(file) {
  const { previewJobDescription } = await import('./jobDescriptionPreviewService.js')
  return previewJobDescription(file)
}

async function deleteWithDefaultService(args) {
  const { deleteJobDescriptionFile } = await import('./jobDescriptionFileStorageService.js')
  return deleteJobDescriptionFile(args)
}

export async function prepareJobDescriptionCreation({
  db,
  userId,
  file,
  signingSecret,
}, dependencies = {}) {
  if (!db?.query) throw new TypeError('A database query interface is required')

  const secret = resolveSigningSecret(signingSecret)
  const previewFile = dependencies.previewFile || previewWithDefaultService
  const storeFile = dependencies.storeFile || storeWithDefaultService
  const previewId = dependencies.previewId || crypto.randomUUID()
  const preview = await previewFile(file)
  const storedFile = await storeFile({ userId, file, previewId })
  let receipt

  try {
    receipt = issueJobDescriptionPreviewReceipt({
      userId,
      preview,
      storedFile,
      secret,
      now: dependencies.now === undefined ? Date.now() : dependencies.now,
      previewId,
    })
    await db.query(
      `INSERT INTO job_description_creation_requests (
         user_id,
         preview_id,
         file_sha256,
         preview_sha256,
         file_url,
         expires_at,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [
        userId,
        receipt.previewId,
        storedFile.fileSha256,
        receipt.previewSha256,
        storedFile.fileUrl,
        receipt.expiresAt,
      ],
    )
  } catch (error) {
    const deleteFile = dependencies.deleteFile || deleteWithDefaultService
    await deleteFile({ fileUrl: storedFile.fileUrl }).catch((cleanupError) => {
      console.error('[JobDescriptionPreview] Failed to remove untracked source file:', cleanupError)
    })
    throw error
  }

  return {
    ...preview,
    previewToken: receipt.token,
    previewExpiresAt: receipt.expiresAt,
    sourceFile: {
      name: storedFile.fileName,
      sha256: storedFile.fileSha256,
    },
  }
}

export async function confirmJobDescriptionCreation({
  db,
  userId,
  input,
  previewToken,
  signingSecret,
}, dependencies = {}) {
  if (!db?.connect) throw new TypeError('A transactional database pool is required')

  const receipt = verifyJobDescriptionPreviewReceipt({
    token: previewToken,
    userId,
    secret: resolveSigningSecret(signingSecret),
    now: dependencies.now === undefined ? Date.now() : dependencies.now,
  })
  const client = await db.connect()
  let transactionStarted = false

  try {
    await client.query('BEGIN')
    transactionStarted = true

    const claim = await client.query(
      `UPDATE job_description_creation_requests
       SET status = 'processing'
       WHERE user_id = $1
         AND preview_id = $2
         AND file_sha256 = $3
         AND preview_sha256 = $4
         AND file_url = $5
         AND status = 'pending'
         AND expires_at > NOW()
       RETURNING id`,
      [
        userId,
        receipt.previewId,
        receipt.file.fileSha256,
        receipt.previewSha256,
        receipt.file.fileUrl,
      ],
    )

    if (!claim.rows[0]) {
      const existing = await client.query(
        `SELECT job_description.*
         FROM job_description_creation_requests creation_request
         JOIN job_descriptions job_description
           ON job_description.id = creation_request.job_description_id
         WHERE creation_request.user_id = $1
           AND creation_request.preview_id = $2
           AND creation_request.file_sha256 = $3
           AND creation_request.preview_sha256 = $4
           AND creation_request.file_url = $5
           AND creation_request.status = 'completed'
         LIMIT 1`,
        [
          userId,
          receipt.previewId,
          receipt.file.fileSha256,
          receipt.previewSha256,
          receipt.file.fileUrl,
        ],
      )

      if (!existing.rows[0]) {
        throw new JobDescriptionConfirmedCreationError(
          'JD_PREVIEW_ALREADY_CONSUMED',
          'This preview was already used and its job is no longer available.',
        )
      }

      await client.query('COMMIT')
      transactionStarted = false
      return {
        job: existing.rows[0],
        created: false,
        sourceFile: { name: receipt.file.fileName, sha256: receipt.file.fileSha256 },
      }
    }

    const job = await createJobDescription({
      db: client,
      userId,
      input: {
        ...input,
        employmentType: input?.employmentType ?? input?.workMode,
        sourceType: 'file',
      },
      fileUrl: receipt.file.fileUrl,
    })
    await client.query(
      `UPDATE job_description_creation_requests
       SET job_description_id = $2,
           status = 'completed',
           completed_at = NOW()
       WHERE id = $1`,
      [claim.rows[0].id, job.id],
    )
    await client.query('COMMIT')
    transactionStarted = false

    return {
      job,
      created: true,
      sourceFile: { name: receipt.file.fileName, sha256: receipt.file.fileSha256 },
    }
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function cleanupExpiredJobDescriptionPreviews({ db, deleteFile } = {}) {
  if (!db?.query) throw new TypeError('A database query interface is required')
  const removeFile = deleteFile || deleteWithDefaultService
  const result = await db.query(
    `SELECT id, file_url
     FROM job_description_creation_requests
     WHERE status = 'pending'
       AND expires_at <= NOW()
     ORDER BY expires_at ASC
     LIMIT 100`,
  )
  let cleaned = 0

  for (const row of result.rows) {
    try {
      await removeFile({ fileUrl: row.file_url })
      const deleted = await db.query(
        `DELETE FROM job_description_creation_requests
         WHERE id = $1
           AND status = 'pending'
           AND expires_at <= NOW()
         RETURNING id`,
        [row.id],
      )
      if (deleted.rows[0]) cleaned += 1
    } catch (error) {
      console.error('[JobDescriptionPreview] Cleanup failed for preview', row.id, error)
    }
  }

  return cleaned
}

export function startJobDescriptionPreviewCleanupCron({ db, deleteFile } = {}) {
  const runCleanup = () => cleanupExpiredJobDescriptionPreviews({ db, deleteFile })
    .then((count) => {
      if (count > 0) console.log(`[JobDescriptionPreview] Cleaned up ${count} expired source file(s)`)
    })
    .catch((error) => {
      console.error('[JobDescriptionPreview] Cleanup cron failed:', error)
    })

  const interval = setInterval(runCleanup, PREVIEW_CLEANUP_INTERVAL_MS)
  void runCleanup()
  return interval
}
