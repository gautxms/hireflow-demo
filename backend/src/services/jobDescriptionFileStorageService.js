import crypto from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export const MAX_STORED_JOB_DESCRIPTION_BYTES = 20 * 1024 * 1024

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ALLOWED_FILES = new Map([
  ['.pdf', PDF_MIME],
  ['.docx', DOCX_MIME],
])

export class JobDescriptionFileStorageError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'JobDescriptionFileStorageError'
    this.code = code
    this.status = status
  }
}

function createDefaultClient() {
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  })
}

function sanitizeFilename(filename) {
  const basename = path.basename(String(filename || '')).normalize('NFKC')
  const extension = path.extname(basename).toLowerCase()
  const stem = path.basename(basename, extension)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'job-description'
  return `${stem}${extension}`
}

function validateFile(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw new JobDescriptionFileStorageError('JD_FILE_REQUIRED', 'Choose a PDF or DOCX job description.')
  }
  if (file.buffer.length > MAX_STORED_JOB_DESCRIPTION_BYTES) {
    throw new JobDescriptionFileStorageError('JD_FILE_TOO_LARGE', 'JD file must be 20MB or smaller.')
  }

  const fileName = sanitizeFilename(file.originalname)
  const extension = path.extname(fileName).toLowerCase()
  const contentType = String(file.mimetype || '').trim().toLowerCase()
  if (!ALLOWED_FILES.has(extension) || ALLOWED_FILES.get(extension) !== contentType) {
    throw new JobDescriptionFileStorageError('JD_UNSUPPORTED_FILE', 'Upload a PDF or DOCX job description.')
  }
  if (extension === '.pdf' && file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new JobDescriptionFileStorageError('JD_INVALID_FILE', 'Upload a valid PDF or DOCX job description.', 422)
  }
  if (extension === '.docx' && file.buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new JobDescriptionFileStorageError('JD_INVALID_FILE', 'Upload a valid PDF or DOCX job description.', 422)
  }

  return { fileName, contentType }
}

export async function storeJobDescriptionFile({ userId, file }, dependencies = {}) {
  const subject = String(userId || '').trim()
  if (!subject) throw new TypeError('A user id is required')

  const bucket = String(dependencies.bucket || process.env.AWS_S3_BUCKET || '').trim()
  if (!bucket) {
    throw new JobDescriptionFileStorageError(
      'JD_STORAGE_UNAVAILABLE',
      'Job description file storage is temporarily unavailable.',
      503,
    )
  }

  const { fileName, contentType } = validateFile(file)
  const fileSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex')
  const ownerSegment = subject.replace(/[^a-zA-Z0-9_-]/g, '_')
  const key = `job-descriptions/${ownerSegment}/${fileSha256}/${fileName}`
  const client = dependencies.client || createDefaultClient()

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: contentType,
    ContentDisposition: `attachment; filename="${fileName}"`,
    ServerSideEncryption: 'AES256',
    Metadata: {
      sha256: fileSha256,
      owner: ownerSegment,
    },
  }))

  return {
    fileUrl: `s3://${bucket}/${key}`,
    fileSha256,
    fileName,
    contentType,
  }
}
