import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchJobDescriptionFile,
  isStoredJobDescriptionFileUrl,
  JobDescriptionFileStorageError,
  storeJobDescriptionFile,
} from './jobDescriptionFileStorageService.js'

test('stores a validated JD under a deterministic encrypted S3 key', async () => {
  const commands = []
  const file = {
    originalname: '../Senior Platform Engineer.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF durable source'),
  }
  const stored = await storeJobDescriptionFile(
    { userId: 42, file },
    { bucket: 'private-hireflow', client: { async send(command) { commands.push(command) } } },
  )

  assert.equal(commands.length, 1)
  assert.equal(commands[0].input.Bucket, 'private-hireflow')
  assert.match(commands[0].input.Key, /^job-descriptions\/42\/[a-f0-9]{64}\/Senior-Platform-Engineer\.pdf$/)
  assert.equal(commands[0].input.ServerSideEncryption, 'AES256')
  assert.equal(commands[0].input.Body, file.buffer)
  assert.equal(stored.fileUrl, `s3://private-hireflow/${commands[0].input.Key}`)
  assert.equal(stored.fileSha256, commands[0].input.Metadata.sha256)
  assert.equal(stored.fileName, 'Senior-Platform-Engineer.pdf')
})

test('rejects invalid file content before contacting S3', async () => {
  let sent = false
  await assert.rejects(
    storeJobDescriptionFile(
      {
        userId: 42,
        file: { originalname: 'role.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') },
      },
      { bucket: 'private-hireflow', client: { async send() { sent = true } } },
    ),
    (error) => error instanceof JobDescriptionFileStorageError && error.code === 'JD_INVALID_FILE',
  )
  assert.equal(sent, false)
})

test('retrieves only an attachment from the configured private bucket', async () => {
  const commands = []
  const fileUrl = `s3://private-hireflow/job-descriptions/42/${'c'.repeat(64)}/role.pdf`
  const attachment = await fetchJobDescriptionFile(
    { fileUrl },
    {
      bucket: 'private-hireflow',
      client: {
        async send(command) {
          commands.push(command)
          return { Body: Buffer.from('%PDF stored source'), ContentType: 'application/pdf' }
        },
      },
    },
  )

  assert.equal(isStoredJobDescriptionFileUrl(fileUrl), true)
  assert.deepEqual(commands[0].input, {
    Bucket: 'private-hireflow',
    Key: `job-descriptions/42/${'c'.repeat(64)}/role.pdf`,
  })
  assert.equal(attachment.buffer.toString(), '%PDF stored source')
  assert.equal(attachment.fileName, 'role.pdf')
  assert.equal(attachment.contentType, 'application/pdf')

  await assert.rejects(
    fetchJobDescriptionFile(
      { fileUrl: fileUrl.replace('private-hireflow', 'another-bucket') },
      { bucket: 'private-hireflow', client: { async send() { throw new Error('must not send') } } },
    ),
    { code: 'JD_STORAGE_REFERENCE_INVALID', status: 404 },
  )
})
