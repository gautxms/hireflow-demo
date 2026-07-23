import multer from 'multer'
import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import {
  enforceUploadLimit,
  recordChunkUploadUsage,
  requireActiveSubscription,
} from '../middleware/subscriptionCheck.js'
import {
  consumeResumeQuotaReservation,
  releaseResumeQuotaReservation,
} from '../services/resumeQuotaReservations.js'
import {
  CHUNK_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  completeChunkUpload,
  getChunkUploadQuotaState,
  getChunkUploadStatus,
  initChunkUpload,
  storeChunk,
} from '../services/fileUploadService.js'

const router = Router()
const MAX_BATCH_FILE_COUNT = 20

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHUNK_SIZE_BYTES,
    files: 1,
  },
})

router.post('/preflight', requireAuth, requireActiveSubscription, (req, res, next) => {
  const fileCount = Number(req.body?.fileCount)
  if (!Number.isInteger(fileCount) || fileCount <= 0 || fileCount > MAX_BATCH_FILE_COUNT) {
    return res.status(400).json({
      error: `fileCount must be an integer between 1 and ${MAX_BATCH_FILE_COUNT}`,
    })
  }
  req.quotaRequestedUploads = fileCount
  return next()
}, enforceUploadLimit, (req, res) => res.json({
  ok: true,
  reservationId: req.usageContext?.quotaReservation?.id || null,
  requested: req.usageContext?.requestedUploads || 0,
  limit: req.usageContext?.uploadLimit || 0,
  used: req.usageContext?.currentUsage || 0,
  remaining: req.usageContext?.remainingUploads || 0,
}))

router.post('/init', requireAuth, requireActiveSubscription, enforceUploadLimit, async (req, res) => {
  const quotaReservationId = req.usageContext?.quotaReservation?.id || null
  let quotaSettled = false
  try {
    const { filename, fileSize, mimeType, jobDescriptionId, analysisId, analysisName, clientChunkSize } = req.body || {}
    console.log(
      '[HireFlow] JD received at endpoint:',
      jobDescriptionId ? `${String(jobDescriptionId).slice(0, 80)}...` : 'NONE',
    )

    if (!filename || !fileSize) {
      return res.status(400).json({ error: 'filename and fileSize are required' })
    }

    const parsedSize = Number(fileSize)

    if (Number.isNaN(parsedSize) || parsedSize <= 0) {
      return res.status(400).json({ error: 'fileSize must be a positive number' })
    }

    if (parsedSize > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'Files above 25MB are not supported yet. Please compress the resume or upload a smaller PDF, DOC, or DOCX file.' })
    }

    const session = await initChunkUpload({
      userId: req.userId,
      filename,
      fileSize: parsedSize,
      mimeType,
      jobDescriptionId: jobDescriptionId || null,
      analysisId: analysisId || null,
      analysisName: analysisName || null,
      clientChunkSize,
      quotaReservationId,
    })
    const sessionQuotaState = getChunkUploadQuotaState(session)

    if (sessionQuotaState.quotaRecorded !== true) {
      if (quotaReservationId) {
        await consumeResumeQuotaReservation({
          userId: req.userId,
          reservationId: quotaReservationId,
          units: 1,
          monthStart: req.usageContext.monthStart,
          ipAddress: req.usageContext.ipAddress,
          uploadId: session.uploadId,
        })
      } else {
        await recordChunkUploadUsage({
          userId: req.userId,
          uploadId: session.uploadId,
          monthStart: req.usageContext.monthStart,
          ipAddress: req.usageContext.ipAddress,
        })
      }
    } else if (quotaReservationId) {
      await releaseResumeQuotaReservation({
        userId: req.userId,
        reservationId: quotaReservationId,
        units: 1,
      })
    }
    quotaSettled = true

    return res.json(session)
  } catch (error) {
    if (quotaReservationId && !quotaSettled) {
      try {
        await releaseResumeQuotaReservation({
          userId: req.userId,
          reservationId: quotaReservationId,
          units: 1,
        })
      } catch (releaseError) {
        console.error('[UploadChunks] failed to release quota reservation after init error:', releaseError)
      }
    }
    console.error('[UploadChunks] init failed:', error)
    const message = error.message || 'Unable to initialize chunk upload'
    const statusCode = message.startsWith('clientChunkSize ') ? 400 : 500
    return res.status(statusCode).json({ error: message })
  }
})

router.get('/:uploadId/status', requireAuth, async (req, res) => {
  try {
    const status = await getChunkUploadStatus({ userId: req.userId, uploadId: req.params.uploadId })

    if (!status) {
      return res.status(404).json({ error: 'Upload session not found' })
    }

    return res.json(status)
  } catch (error) {
    console.error('[UploadChunks] status failed:', error)
    return res.status(500).json({ error: 'Unable to fetch upload status' })
  }
})

router.post('/:uploadId/chunk', requireAuth, requireActiveSubscription, (req, res, next) => {
  chunkUpload.single('chunk')(req, res, (error) => {
    if (!error) {
      return next()
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Chunk exceeds 5MB limit' })
    }

    return res.status(400).json({ error: error.message || 'Invalid chunk upload request' })
  })
}, async (req, res) => {
  try {
    const { chunkIndex, totalChunks } = req.body || {}

    if (!req.file) {
      return res.status(400).json({ error: 'chunk is required' })
    }

    const parsedChunkIndex = Number(chunkIndex)
    const parsedTotalChunks = Number(totalChunks)

    if (!Number.isInteger(parsedChunkIndex) || parsedChunkIndex < 0) {
      return res.status(400).json({ error: 'chunkIndex must be a non-negative integer' })
    }

    if (!Number.isInteger(parsedTotalChunks) || parsedTotalChunks <= 0) {
      return res.status(400).json({ error: 'totalChunks must be a positive integer' })
    }

    await storeChunk({
      userId: req.userId,
      uploadId: req.params.uploadId,
      chunkIndex: parsedChunkIndex,
      totalChunks: parsedTotalChunks,
      chunkBuffer: req.file.buffer,
    })

    return res.status(202).json({ ok: true, chunkIndex: parsedChunkIndex })
  } catch (error) {
    console.error('[UploadChunks] chunk failed:', error)
    return res.status(400).json({ error: error.message || 'Unable to store chunk' })
  }
})

router.post('/:uploadId/complete', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const completeResult = await completeChunkUpload({
      userId: req.userId,
      uploadId: req.params.uploadId,
    })

    return res.status(202).json(completeResult)
  } catch (error) {
    console.error('[UploadChunks] complete failed:', error)
    return res.status(400).json({ error: error.message || 'Unable to complete upload' })
  }
})

export default router
