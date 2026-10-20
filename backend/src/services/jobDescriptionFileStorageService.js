import crypto from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

function parseStoredFileUrl(fileUrl) {
  try {
    const parsed = new URL(String(fileUrl || ''))
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    if (parsed.protocol !== 's3:' || !parsed.hostname || !key.startsWith('job-descriptions/')) {
      throw new Error('invalid storage reference')
    }
    return { bucket: parsed.hostname, key }
  } catch {
    throw new JobDescriptionFileStorageError(
      'JD_STORAGE_REFERENCE_INVALID',
      'The stored job description attachment is unavailable.',
      404,
    )
  }
}

async function readBody(body) {
  if (Buffer.isBuffer(body)) return body
  if (typeof body?.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const chunk of body) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  throw new JobDescriptionFileStorageError(
    'JD_STORAGE_READ_FAILED',
    'The stored job description attachment could not be read.',
    503,
  )
}

export function isStoredJobDescriptionFileUrl(fileUrl) {
  return String(fileUrl || '').startsWith('s3://')
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

export async function fetchJobDescriptionFile({ fileUrl }, dependencies = {}) {
  const reference = parseStoredFileUrl(fileUrl)
  const expectedBucket = String(dependencies.bucket || process.env.AWS_S3_BUCKET || '').trim()
  if (!expectedBucket) {
    throw new JobDescriptionFileStorageError(
      'JD_STORAGE_UNAVAILABLE',
      'Job description file storage is temporarily unavailable.',
      503,
    )
  }
  if (reference.bucket !== expectedBucket) {
    throw new JobDescriptionFileStorageError(
      'JD_STORAGE_REFERENCE_INVALID',
      'The stored job description attachment is unavailable.',
      404,
    )
  }

  const client = dependencies.client || createDefaultClient()
  const result = await client.send(new GetObjectCommand({
    Bucket: reference.bucket,
    Key: reference.key,
  }))
  const fileName = sanitizeFilename(path.basename(reference.key))
  const fallbackType = ALLOWED_FILES.get(path.extname(fileName).toLowerCase()) || 'application/octet-stream'
  const storedContentType = String(result.ContentType || '').trim().toLowerCase()

  return {
    buffer: await readBody(result.Body),
    fileName,
    contentType: [...ALLOWED_FILES.values()].includes(storedContentType) ? storedContentType : fallbackType,
  }
}
