import crypto from 'node:crypto'
import process from 'node:process'
import { resolveMonthlyResumeAnalysisLimit } from '../config/resumeAnalysisQuota.js'
import { pool } from '../db/client.js'
import {
  getMonthStart,
  getUsageCount,
  getUsageCountForPeriod,
  getUsageOverride,
  recordUploadUsage,
} from '../middleware/subscriptionCheck.js'
import { canUsePaidMutation, hasScheduledCancellationAccess } from '../utils/subscriptionAccess.js'
import { normalizeResumeFileMetadata } from '../utils/resumeFileMetadata.js'
import { isAcceptedResumeUpload, resolveEffectiveMimeType } from '../utils/fileMime.js'
import {
  resolveResumeQuotaPeriod,
  RESUME_QUOTA_PERIOD_SOURCES,
} from '../utils/resumeQuotaPeriod.js'
import {
  allocateResumeQuotaUnit,
  isResumeQuotaReservationsEnabled,
  releaseResumeQuotaAllocation,
  releaseResumeQuotaReservation,
  reserveResumeQuotaUnits,
  ResumeQuotaExceededError,
} from './resumeQuotaReservations.js'
import { scanFileBuffer } from './virusScanService.js'

export const MAX_RESUME_ANALYSIS_FILES = 20
export const MAX_RESUME_ANALYSIS_FILE_BYTES = 25 * 1024 * 1024

export class ResumeAnalysisCreationError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message)
    this.name = 'ResumeAnalysisCreationError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function monthEnd(monthStart) {
  return new Date(Date.UTC(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1,
    1,
  ))
}

async function enqueueWithDefaultService(args) {
  const { enqueueParseJob } = await import('./jobQueue.js')
  return enqueueParseJob(args)
}

async function prepareQuota({ userId, requestedUploads, env = process.env }) {
  const accountResult = await pool.query(
    `SELECT subscription_status, subscription_plan, quota_anchor_at,
            subscription_started_at, trial_ends_at, cancellation_effective_at,
            current_period_end
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  )
  const account = accountResult.rows[0]
  if (!account || !canUsePaidMutation(account)) {
    throw new ResumeAnalysisCreationError(
      'SUBSCRIPTION_REQUIRED',
      'An active HireFlow subscription is required to create a resume analysis.',
      403,
    )
  }

  const subscriptionStatus = hasScheduledCancellationAccess(account)
    ? 'active'
    : account.subscription_status
  const subscriptionContext = {
    status: subscriptionStatus,
    plan: account.subscription_plan || null,
    quotaAnchorAt: account.quota_anchor_at || null,
    trialStartedAt: account.subscription_started_at || null,
    trialEndsAt: account.trial_ends_at || account.current_period_end || null,
  }
  const legacyPeriodStart = getMonthStart()
  const legacyPeriodEnd = monthEnd(legacyPeriodStart)
  const usageOverride = await getUsageOverride(userId, legacyPeriodStart)
  const uploadLimit = resolveMonthlyResumeAnalysisLimit(
    subscriptionStatus,
    usageOverride,
    subscriptionContext.plan,
  )
  const reservationsEnabled = isResumeQuotaReservationsEnabled(env)
  const resolvedPeriod = resolveResumeQuotaPeriod({
    subscriptionStatus: subscriptionContext.status,
    quotaAnchorAt: subscriptionContext.quotaAnchorAt,
    trialStartedAt: subscriptionContext.trialStartedAt,
    trialEndsAt: subscriptionContext.trialEndsAt,
  })
  const enforcementPeriod = reservationsEnabled
    || resolvedPeriod.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL
    ? resolvedPeriod
    : {
        start: legacyPeriodStart,
        end: legacyPeriodEnd,
        source: RESUME_QUOTA_PERIOD_SOURCES.CALENDAR_FALLBACK,
      }
  const currentUsage = reservationsEnabled
    || enforcementPeriod.source === RESUME_QUOTA_PERIOD_SOURCES.TRIAL
    ? await getUsageCountForPeriod(
      userId,
      enforcementPeriod.start,
      enforcementPeriod.end,
      usageOverride?.reset_usage,
    )
    : await getUsageCount(userId, legacyPeriodStart, usageOverride?.reset_usage)
  const remaining = Math.max(uploadLimit - currentUsage, 0)

  if (currentUsage + requestedUploads > uploadLimit) {
    throw new ResumeAnalysisCreationError(
      'RESUME_ANALYSIS_QUOTA_EXCEEDED',
      `This batch exceeds your resume analysis allowance. You can submit ${remaining} more resume${remaining === 1 ? '' : 's'} this period.`,
      429,
      { limit: uploadLimit, used: currentUsage, requested: requestedUploads, remaining },
    )
  }

  if (!reservationsEnabled) {
    await recordUploadUsage({
      userId,
      monthStart: enforcementPeriod.start,
      ipAddress: 'mcp',
      uploadCount: requestedUploads,
    })
    return { reservationId: null }
  }

  try {
    const reserved = await reserveResumeQuotaUnits({
      userId,
      periodStart: enforcementPeriod.start,
      periodEnd: enforcementPeriod.end,
      uploadLimit,
      requestedUnits: requestedUploads,
      idempotencyKey: `mcp-analysis:${crypto.randomUUID()}`,
      shouldResetUsage: usageOverride?.reset_usage,
    })
    return { reservationId: reserved.reservation.id }
  } catch (error) {
    if (error instanceof ResumeQuotaExceededError) {
      throw new ResumeAnalysisCreationError(
        'RESUME_ANALYSIS_QUOTA_EXCEEDED',
        `This batch exceeds your resume analysis allowance. You can submit ${error.details.remaining} more resume${error.details.remaining === 1 ? '' : 's'} this period.`,
        429,
        error.details,
      )
    }
    throw error
  }
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_RESUME_ANALYSIS_FILES) {
    throw new ResumeAnalysisCreationError(
      'INVALID_RESUME_BATCH',
      `Attach between 1 and ${MAX_RESUME_ANALYSIS_FILES} resume files.`,
    )
  }

  return files.map((file) => {
    const buffer = file?.buffer
    const originalname = String(file?.originalname || '').trim()
    const mimetype = String(file?.mimetype || '').trim().toLowerCase()
    if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
      throw new ResumeAnalysisCreationError('INVALID_RESUME_FILE', `${originalname || 'A resume'} is empty.`)
    }
    if (buffer.length > MAX_RESUME_ANALYSIS_FILE_BYTES) {
      throw new ResumeAnalysisCreationError(
        'RESUME_FILE_TOO_LARGE',
        `${originalname || 'A resume'} must be 25MB or smaller.`,
      )
    }
    if (!isAcceptedResumeUpload(mimetype, originalname)) {
      throw new ResumeAnalysisCreationError(
        'RESUME_FILE_TYPE_NOT_ALLOWED',
        `${originalname || 'A resume'} must be a PDF, DOC, DOCX, or TXT file.`,
      )
    }
    return { ...file, originalname, mimetype, size: buffer.length }
  })
}

export async function createResumeAnalysis({
  db = pool,
  userId,
  files,
  analysisName,
  jobDescriptionId = null,
  env = process.env,
}, dependencies = {}) {
  if (!db?.query) throw new TypeError('A database query interface is required')
  const normalizedFiles = validateFiles(files)
  const normalizedName = String(analysisName || '').trim()
  if (!normalizedName) {
    throw new ResumeAnalysisCreationError('ANALYSIS_NAME_REQUIRED', 'Give this analysis a name.')
  }

  const scanFile = dependencies.scanFile || scanFileBuffer
  const enqueue = dependencies.enqueue || enqueueWithDefaultService
  const reserveQuota = dependencies.prepareQuota || prepareQuota
  const allocateQuota = dependencies.allocateQuota || allocateResumeQuotaUnit
  const releaseAllocation = dependencies.releaseAllocation || releaseResumeQuotaAllocation
  const releaseReservation = dependencies.releaseReservation || releaseResumeQuotaReservation
  const normalizedJobId = String(jobDescriptionId || '').trim() || null

  if (normalizedJobId) {
    const jobResult = await db.query(
      `SELECT id
       FROM job_descriptions
       WHERE id = $1
         AND user_id = $2
         AND status <> 'archived'
       LIMIT 1`,
      [normalizedJobId, userId],
    )
    if (!jobResult.rows[0]) {
      throw new ResumeAnalysisCreationError(
        'JOB_DESCRIPTION_NOT_FOUND',
        'The selected HireFlow job was not found or is archived.',
        404,
      )
    }
  }

  const quota = await reserveQuota({
    userId,
    requestedUploads: normalizedFiles.length,
    env,
  })
  let analysisId = null
  const results = []

  try {
    const analysisResult = await db.query(
      `INSERT INTO analyses (user_id, job_description_id, status, name)
       VALUES ($1, $2, 'processing', $3)
       RETURNING id`,
      [userId, normalizedJobId, normalizedName],
    )
    analysisId = analysisResult.rows[0]?.id
    if (!analysisId) throw new Error('Analysis creation did not return an id')

    for (const file of normalizedFiles) {
      const metadata = normalizeResumeFileMetadata({
        originalFilename: file.originalname,
        reportedMimeType: file.mimetype,
      })
      const effectiveMimeType = resolveEffectiveMimeType(
        file.mimetype,
        metadata.originalFilename,
      ) || metadata.normalizedMimeType || file.mimetype
      const scanResult = await scanFile(file.buffer, {
        filename: metadata.storageFilename,
        originalFilename: metadata.originalFilename,
        originalMimeType: metadata.originalMimeType,
        fileExtension: metadata.fileExtension || null,
        mimetype: effectiveMimeType,
        userId,
        analysisId,
      })

      if (!scanResult.ok) {
        results.push({
          name: metadata.originalFilename,
          status: 'failed',
          reason: scanResult.reason || 'File security scan failed.',
        })
        continue
      }

      const resumeResult = await db.query(
        `INSERT INTO resumes
          (user_id, filename, file_size, file_type, parse_status, scan_status,
           scan_result, file_sha256, original_filename, file_extension,
           original_mime_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING id`,
        [
          userId,
          metadata.storageFilename,
          file.size,
          effectiveMimeType,
          scanResult.status || 'clean',
          scanResult.details ? JSON.stringify(scanResult.details) : null,
          scanResult.sha256 || null,
          metadata.originalFilename,
          metadata.fileExtension || null,
          metadata.originalMimeType,
        ],
      )
      const resumeId = resumeResult.rows[0]?.id
      if (!resumeId) throw new Error('Resume creation did not return an id')

      let quotaAllocationId = null
      if (quota.reservationId) {
        const allocation = await allocateQuota({
          userId,
          reservationId: quota.reservationId,
          allocationKey: `resume:${resumeId}`,
          resumeId,
        })
        quotaAllocationId = allocation.allocation.id
      }

      let parseJob
      try {
        parseJob = await enqueue({
          resumeId,
          userId,
          filename: metadata.storageFilename,
          originalFilename: metadata.originalFilename,
          originalMimeType: metadata.originalMimeType,
          fileExtension: metadata.fileExtension || null,
          mimetype: effectiveMimeType,
          fileBuffer: file.buffer,
          analysisId,
          jobDescriptionId: normalizedJobId,
          quotaAllocationId,
        })
      } catch (error) {
        if (quotaAllocationId) {
          await releaseAllocation({
            userId,
            allocationId: quotaAllocationId,
            reason: 'parse_enqueue_failed',
          })
        }
        throw error
      }

      await db.query(
        `INSERT INTO analysis_items (analysis_id, resume_id, parse_job_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (analysis_id, resume_id) DO NOTHING`,
        [analysisId, resumeId, parseJob.jobId],
      )
      results.push({
        name: metadata.originalFilename,
        status: 'queued',
        resumeId: String(resumeId),
        parseJobId: String(parseJob.jobId),
      })
    }

    const queued = results.filter((result) => result.status === 'queued').length
    const failed = results.length - queued
    const status = queued > 0 ? 'processing' : 'failed'
    await db.query(
      `UPDATE analyses
       SET status = $2,
           error_summary = $3
       WHERE id = $1`,
      [analysisId, status, queued === 0 ? 'All uploads failed validation or scanning.' : null],
    )

    return {
      analysisId: String(analysisId),
      name: normalizedName,
      status,
      jobDescriptionId: normalizedJobId,
      queued,
      failed,
      files: results,
    }
  } catch (error) {
    if (analysisId) {
      await db.query(
        `UPDATE analyses
         SET status = 'failed',
             error_summary = $2
         WHERE id = $1`,
        [analysisId, error.message || 'Analysis creation failed'],
      ).catch(() => {})
    }
    if (error instanceof ResumeAnalysisCreationError) throw error
    throw new ResumeAnalysisCreationError(
      'RESUME_ANALYSIS_CREATION_FAILED',
      'HireFlow could not queue this resume analysis. Please try again.',
      500,
    )
  } finally {
    if (quota.reservationId) {
      await releaseReservation({
        userId,
        reservationId: quota.reservationId,
        units: Number.MAX_SAFE_INTEGER,
      }).catch((error) => {
        console.error('[MCP] Failed to release unused resume quota:', { name: error?.name })
      })
    }
  }
}
