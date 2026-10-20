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

export async function prepareJobDescriptionCreation({
  userId,
  file,
  signingSecret,
}, dependencies = {}) {
  const secret = resolveSigningSecret(signingSecret)
  const previewFile = dependencies.previewFile || previewWithDefaultService
  const storeFile = dependencies.storeFile || storeWithDefaultService
  const preview = await previewFile(file)
  const storedFile = await storeFile({ userId, file })
  const receipt = issueJobDescriptionPreviewReceipt({
    userId,
    preview,
    storedFile,
    secret,
    now: dependencies.now === undefined ? Date.now() : dependencies.now,
    previewId: dependencies.previewId,
  })

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
      `INSERT INTO job_description_creation_requests (
         user_id,
         preview_id,
         file_sha256,
         preview_sha256
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, preview_id) DO NOTHING
       RETURNING id`,
      [userId, receipt.previewId, receipt.file.fileSha256, receipt.previewSha256],
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
         LIMIT 1`,
        [userId, receipt.previewId, receipt.file.fileSha256, receipt.previewSha256],
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
      input: { ...input, sourceType: 'file' },
      fileUrl: receipt.file.fileUrl,
    })
    await client.query(
      `UPDATE job_description_creation_requests
       SET job_description_id = $2,
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
