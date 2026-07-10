#!/usr/bin/env node
import 'dotenv/config'
import { pool } from '../src/db/client.js'
import { getMonthStart } from '../src/middleware/subscriptionCheck.js'

const SIMULATION_IP = 'quota-simulation-local'
const SUPPORTED_TARGETS = new Set([750, 790, 795, 799, 800, 801])
const ALLOWED_SIMULATION_ENVIRONMENTS = new Set(['local', 'staging'])

function readArg(name) {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to simulate resume usage when NODE_ENV=production.')
  }
  if (process.env.HIREFLOW_ALLOW_USAGE_SIMULATION !== 'true') {
    throw new Error('Set HIREFLOW_ALLOW_USAGE_SIMULATION=true to confirm this local/staging-only usage simulation.')
  }
  if (!ALLOWED_SIMULATION_ENVIRONMENTS.has(process.env.HIREFLOW_USAGE_SIMULATION_ENV)) {
    throw new Error('Set HIREFLOW_USAGE_SIMULATION_ENV=local or HIREFLOW_USAGE_SIMULATION_ENV=staging to confirm the target environment.')
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.')
  }
}

async function setSimulatedUsage({ userId, targetUsage }) {
  const monthStart = getMonthStart()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const realUsageResult = await client.query(
      `SELECT COUNT(*)::int AS usage_count
       FROM usage_log
       WHERE user_id = $1
         AND month_start = $2
         AND ip_address IS DISTINCT FROM $3`,
      [userId, monthStart, SIMULATION_IP],
    )
    const realUsage = Number(realUsageResult.rows[0]?.usage_count || 0)
    const simulationRowsNeeded = Math.max(targetUsage - realUsage, 0)

    await client.query(
      `DELETE FROM usage_log
       WHERE user_id = $1
         AND month_start = $2
         AND ip_address = $3`,
      [userId, monthStart, SIMULATION_IP],
    )

    if (simulationRowsNeeded > 0) {
      await client.query(
        `INSERT INTO usage_log (user_id, ip_address, month_start)
         SELECT $1, $2, $3
         FROM generate_series(1, $4)`,
        [userId, SIMULATION_IP, monthStart, simulationRowsNeeded],
      )
    }

    await client.query('COMMIT')
    return {
      userId,
      requestedTargetUsage: targetUsage,
      realUsage,
      simulatedRowsInserted: simulationRowsNeeded,
      effectiveUsage: realUsage + simulationRowsNeeded,
      monthStart: monthStart.toISOString(),
      simulationIp: SIMULATION_IP,
      note: realUsage > targetUsage
        ? 'Existing non-simulation usage is already above the requested target; effective usage was not reduced.'
        : 'Simulation rows set effective usage to the requested target.',
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

try {
  assertSafeEnvironment()
  const userId = Number(readArg('user-id'))
  const targetUsage = Number(readArg('usage'))

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Provide a positive integer --user-id.')
  }
  if (!SUPPORTED_TARGETS.has(targetUsage)) {
    throw new Error(`Provide --usage as one of: ${[...SUPPORTED_TARGETS].join(', ')}.`)
  }

  const result = await setSimulatedUsage({ userId, targetUsage })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`[UsageSimulation] ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
