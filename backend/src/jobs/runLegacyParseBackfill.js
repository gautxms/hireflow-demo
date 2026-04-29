import 'dotenv/config'
import { pool } from '../db/client.js'
import { backfillAnalysesFromLegacyParse } from './backfillAnalysesFromLegacyParse.js'
import { backfillCandidateProfilesFromLegacyParse } from './backfillCandidateProfilesFromLegacyParse.js'

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: true,
    userId: null,
    limit: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim()

    if (arg === '--execute') {
      options.dryRun = false
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--user-id') {
      options.userId = Number(argv[index + 1] || 0) || null
      index += 1
      continue
    }

    if (arg === '--limit') {
      options.limit = Number(argv[index + 1] || 0) || null
      index += 1
    }
  }

  return options
}

async function run() {
  const options = parseCliArgs()

  console.log(`[Backfill] Starting legacy parse migration (${options.dryRun ? 'dry-run' : 'execute'})`)

  try {
    const analyses = await backfillAnalysesFromLegacyParse(options)
    const candidateProfiles = await backfillCandidateProfilesFromLegacyParse(options)

    const reconciliation = {
      dryRun: options.dryRun,
      analyses,
      candidateProfiles,
    }

    console.log('[Backfill] Combined reconciliation summary')
    console.log(JSON.stringify(reconciliation, null, 2))
  } catch (error) {
    console.error('[Backfill] Failed:', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
}
