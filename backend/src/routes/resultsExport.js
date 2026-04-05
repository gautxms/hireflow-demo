import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { buildCandidatesCsv } from '../services/csvExportService.js'
import { applyCandidateFilters, normalizeCandidate, sortCandidates } from './results.js'

const router = Router()
const EXPORT_LIMIT = 1000

router.post('/csv', requireAuth, async (req, res) => {
  try {
    const {
      candidates = [],
      sortBy = 'score',
      sortOrder = 'desc',
      filters = {},
    } = req.body || {}

    if (!Array.isArray(candidates)) {
      return res.status(400).json({ error: 'candidates must be an array' })
    }

    const normalized = candidates.map(normalizeCandidate)
    const filtered = applyCandidateFilters(normalized, filters)
    const sorted = sortCandidates(filtered, sortBy, sortOrder)

    if (sorted.length > EXPORT_LIMIT) {
      return res.status(400).json({
        error: `Export limit exceeded. Please export ${EXPORT_LIMIT} rows or fewer at a time.`,
      })
    }

    const csv = buildCandidatesCsv(sorted)

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="candidate-results-${Date.now()}.csv"`)

    return res.status(200).send(csv)
  } catch (error) {
    console.error('[ResultsExport] CSV export failed:', error)
    return res.status(500).json({ error: 'Unable to export CSV' })
  }
})

export default router
