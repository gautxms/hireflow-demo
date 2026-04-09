import multer from 'multer'
import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { sanitizeFilename } from '../utils/sanitize.js'
import {
  CHUNK_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  completeChunkUpload,
  getChunkUploadStatus,
  initChunkUpload,
  storeChunk,
} from '../services/fileUploadService.js'

const router = Router()

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHUNK_SIZE_BYTES,
    files: 1,
  },
})

router.post('/init', requireAuth, async (req, res) => {
  try {
    const { filename, fileSize, mimeType, jobDescriptionId } = req.body || {}

    if (!filename || !fileSize) {
      return res.status(400).json({ error: 'filename and fileSize are required' })
    }

    const parsedSize = Number(fileSize)

    if (Number.isNaN(parsedSize) || parsedSize <= 0) {
      return res.status(400).json({ error: 'fileSize must be a positive number' })
    }

    if (parsedSize > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'Files over 100MB are not supported' })
    }

    const session = await initChunkUpload({
      userId: req.userId,
      filename: sanitizeFilename(filename),
      fileSize: parsedSize,
      mimeType,
      jobDescriptionId: jobDescriptionId || null,
    })

    return res.json(session)
  } catch (error) {
    console.error('[UploadChunks] init failed:', error)
    return res.status(500).json({ error: error.message || 'Unable to initialize chunk upload' })
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

router.post('/:uploadId/chunk', requireAuth, (req, res, next) => {
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

router.post('/:uploadId/complete', requireAuth, async (req, res) => {
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
