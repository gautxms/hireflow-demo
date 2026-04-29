import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { hashPassword, verifyPassword } from './passwordHash.js'
import { markTokenUsedAndResetPassword } from './resetTokenService.js'

test('password reset stores PBKDF2 hash and login verifier accepts only new password', async () => {
  const originalConnect = pool.connect.bind(pool)
  const userRecord = {
    id: 42,
    password_hash: hashPassword('OldPassword!1'),
  }

  const issuedQueries = []
  const fakeClient = {
    async query(queryText, params = []) {
      const sql = String(queryText).trim()
      issuedQueries.push({ sql, params })

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] }
      }

      if (sql.startsWith('UPDATE users')) {
        userRecord.password_hash = params[0]
        return { rowCount: 1, rows: [] }
      }

      if (sql.startsWith('UPDATE password_reset_tokens') || sql.startsWith('DELETE FROM password_reset_tokens')) {
        return { rowCount: 1, rows: [] }
      }

      throw new Error(`Unexpected SQL in resetTokenService.test: ${sql}`)
    },
    release() {},
  }

  pool.connect = async () => fakeClient

  try {
    const newPassword = 'NewPassword!2'
    await markTokenUsedAndResetPassword({
      tokenId: 'token-1',
      userId: userRecord.id,
      passwordHash: hashPassword(newPassword),
    })

    assert.equal(userRecord.password_hash.startsWith('$pbkdf2$'), true)
    assert.equal(verifyPassword(newPassword, userRecord.password_hash), true)
    assert.equal(verifyPassword('OldPassword!1', userRecord.password_hash), false)
    assert.equal(issuedQueries.some(({ sql }) => sql.includes('crypt(')), false)
  } finally {
    pool.connect = originalConnect
  }
})
