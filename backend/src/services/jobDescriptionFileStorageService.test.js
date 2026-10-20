import test from 'node:test'
import assert from 'node:assert/strict'
import {
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
