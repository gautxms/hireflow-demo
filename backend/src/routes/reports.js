import { Router } from 'express'
import { pool } from '../db/client.js'

const router = Router()

function normalizeFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return {}
  }

  return filters
}

function normalizeColumns(columns) {
  if (!Array.isArray(columns)) {
    return []
  }

  return columns
    .map((column) => String(column || '').trim())
    .filter(Boolean)
}

function mapRecord(row) {
  return {
    id: row.id,
    ownerId: Number(row.user_id),
    name: row.name,
    filters: row.filters && typeof row.filters === 'object' ? row.filters : {},
    columns: Array.isArray(row.columns) ? row.columns : [],
    scheduleEnabled: Boolean(row.schedule_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM report_definitions
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId],
    )

    return res.json({ items: result.rows.map(mapRecord) })
  } catch (error) {
    console.error('[Reports] Failed to list report definitions:', error)
    return res.status(500).json({ error: 'Unable to list report definitions' })
  }
})

router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    const filters = normalizeFilters(req.body?.filters)
    const columns = normalizeColumns(req.body?.columns)
    const scheduleEnabled = Boolean(req.body?.scheduleEnabled)

    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const result = await pool.query(
      `INSERT INTO report_definitions (user_id, name, filters, columns, schedule_enabled)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       RETURNING *`,
      [req.userId, name, JSON.stringify(filters), JSON.stringify(columns), scheduleEnabled],
    )

    return res.status(201).json({ item: mapRecord(result.rows[0]) })
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'A report with this name already exists' })
    }

    console.error('[Reports] Failed to create report definition:', error)
    return res.status(500).json({ error: 'Unable to create report definition' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    const filters = normalizeFilters(req.body?.filters)
    const columns = normalizeColumns(req.body?.columns)
    const scheduleEnabled = Boolean(req.body?.scheduleEnabled)

    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const result = await pool.query(
      `UPDATE report_definitions
       SET name = $3,
           filters = $4::jsonb,
           columns = $5::jsonb,
           schedule_enabled = $6,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [req.params.id, req.userId, name, JSON.stringify(filters), JSON.stringify(columns), scheduleEnabled],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Report definition not found' })
    }

    return res.json({ item: mapRecord(result.rows[0]) })
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'A report with this name already exists' })
    }

    console.error('[Reports] Failed to update report definition:', error)
    return res.status(500).json({ error: 'Unable to update report definition' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_definitions
       WHERE id = $1
         AND user_id = $2
       RETURNING id`,
      [req.params.id, req.userId],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Report definition not found' })
    }

    return res.status(204).send()
  } catch (error) {
    console.error('[Reports] Failed to delete report definition:', error)
    return res.status(500).json({ error: 'Unable to delete report definition' })
  }
})

export default router
