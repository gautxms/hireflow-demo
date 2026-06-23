import fs from 'fs/promises'
import path from 'path'
import multer from 'multer'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { sanitizeFilename } from '../utils/sanitize.js'

const router = Router()
const uploadDirectory = path.join(process.cwd(), 'backend', 'uploads', 'job-descriptions')
const MAX_FILE_SIZE = 20 * 1024 * 1024
const JOB_DESCRIPTION_USAGE_SUMMARY_FLAG = String(process.env.JOB_DESCRIPTION_USAGE_SUMMARY_ENABLED || '').trim() === 'true'
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(uploadDirectory, { recursive: true })
      cb(null, uploadDirectory)
    } catch (error) {
      cb(error)
    }
  },
  filename: (_req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname)
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`
    cb(null, unique)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_FILE_TYPES.has(file.mimetype)) {
      return cb(new Error('Only PDF and DOCX files are allowed'))
    }

    return cb(null, true)
  },
})

let schemaReady = false

async function ensureSchema() {
  if (schemaReady) {
    return
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_descriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      requirements TEXT,
      skills JSONB,
      experience_years INTEGER,
      location TEXT,
      salary_min INTEGER,
      salary_max INTEGER,
      salary_currency TEXT NOT NULL DEFAULT 'USD',
      file_url TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_job_descriptions_user_id ON job_descriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_job_descriptions_status ON job_descriptions(status);

    ALTER TABLE resumes
      ADD COLUMN IF NOT EXISTS job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL;

    ALTER TABLE job_descriptions
      ADD COLUMN IF NOT EXISTS salary_currency TEXT NOT NULL DEFAULT 'USD';

    ALTER TABLE job_descriptions
      ADD COLUMN IF NOT EXISTS experience_min INTEGER,
      ADD COLUMN IF NOT EXISTS experience_max INTEGER;

    UPDATE job_descriptions
       SET experience_min = COALESCE(experience_min, experience_years),
           experience_max = COALESCE(experience_max, experience_years)
     WHERE experience_years IS NOT NULL
       AND (experience_min IS NULL OR experience_max IS NULL);

    ALTER TABLE job_descriptions
      ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'unspecified',
      ADD COLUMN IF NOT EXISTS responsibilities TEXT,
      ADD COLUMN IF NOT EXISTS additional_info TEXT,
      ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS archived_reason TEXT,
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

    CREATE INDEX IF NOT EXISTS idx_resumes_job_description_id ON resumes(job_description_id);
    CREATE INDEX IF NOT EXISTS idx_parse_jobs_updated_at ON parse_jobs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_parse_jobs_resume_id_updated_at ON parse_jobs(resume_id, updated_at DESC);
  `)

  schemaReady = true
}

function normalizeSkills(input) {
  if (!input) {
    return []
  }

  if (Array.isArray(input)) {
    return input.map((skill) => String(skill).trim()).filter(Boolean)
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()

    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((skill) => String(skill).trim()).filter(Boolean)
      }
    } catch {
      return trimmed.split(',').map((skill) => skill.trim()).filter(Boolean)
    }
  }

  return []
}

function toIntOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function toIntOrDefault(value, fallback) {
  if (value === '' || value === null || value === undefined) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function mapUsageSummary(row) {
  if (!row || row.resume_count === undefined) {
    return undefined
  }

  return {
    resumeCount: Number(row.resume_count || 0),
    parseJobCount: Number(row.parse_job_count || 0),
    completedCount: Number(row.completed_count || 0),
    failedCount: Number(row.failed_count || 0),
    inProgressCount: Number(row.in_progress_count || 0),
    latestParseJobUpdatedAt: row.latest_parse_job_updated_at || null,
  }
}

function mapRecord(row, options = {}) {
  const mapped = {
    id: row.id,
    title: row.title,
    description: row.description || '',
    requirements: row.requirements || '',
    responsibilities: row.responsibilities || '',
    skills: Array.isArray(row.skills) ? row.skills : [],
    additionalInfo: row.additional_info || '',
    experienceYears: row.experience_years,
    experienceMin: row.experience_min ?? row.experience_years,
    experienceMax: row.experience_max ?? row.experience_years,
    location: row.location,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency || 'USD',
    department: row.department,
    employmentType: row.employment_type,
    priority: row.priority,
    archivedReason: row.archived_reason,
    sourceType: row.source_type,
    version: row.version,
    fileUrl: row.file_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  if (options.includeUsageSummary) {
    mapped.usageSummary = mapUsageSummary(row)
  }

  return mapped
}

router.get('/:id/attachment', async (req, res) => {
  try {
    await ensureSchema()
    const result = await pool.query(
      `SELECT file_url FROM job_descriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    const row = result.rows[0]
    if (!row) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    const storedFileUrl = String(row.file_url || '').trim()
    const filename = path.basename(storedFileUrl)

    if (!filename) {
      return res.status(404).json({ error: 'No attachment found for this job description' })
    }

    const filePath = path.join(uploadDirectory, filename)
    return res.sendFile(filePath)
  } catch (error) {
    console.error('[JobDescriptions] attachment fetch failed:', error)
    return res.status(404).json({ error: 'Attachment not found' })
  }
})

router.get('/', async (req, res) => {
  try {
    await ensureSchema()

    const includeArchived = String(req.query.includeArchived || 'false') === 'true'
    const includeUsageSummary = JOB_DESCRIPTION_USAGE_SUMMARY_FLAG
      && String(req.query.includeUsageSummary || 'false') === 'true'

    const result = includeUsageSummary
      ? await pool.query(
        `SELECT jd.*,
                COUNT(DISTINCT r.id)::int AS resume_count,
                COUNT(pj.id)::int AS parse_job_count,
                COUNT(pj.id) FILTER (WHERE pj.status = 'complete')::int AS completed_count,
                COUNT(pj.id) FILTER (WHERE pj.status IN ('failed', 'stalled'))::int AS failed_count,
                COUNT(pj.id) FILTER (WHERE pj.status IN ('pending', 'processing', 'retrying'))::int AS in_progress_count,
                MAX(pj.updated_at) AS latest_parse_job_updated_at
         FROM job_descriptions jd
         LEFT JOIN resumes r
           ON r.job_description_id = jd.id
          AND r.user_id = jd.user_id
         LEFT JOIN parse_jobs pj
           ON pj.resume_id = r.id
         WHERE jd.user_id = $1
           AND ($2::boolean = true OR jd.status <> 'archived')
         GROUP BY jd.id
         ORDER BY jd.updated_at ASC`,
        [req.userId, includeArchived],
      )
      : await pool.query(
        `SELECT jd.*
         FROM job_descriptions jd
         WHERE jd.user_id = $1
           AND ($2::boolean = true OR jd.status <> 'archived')
         ORDER BY jd.updated_at ASC`,
        [req.userId, includeArchived],
      )

    return res.json({ items: result.rows.map((row) => mapRecord(row, { includeUsageSummary })) })
  } catch (error) {
    console.error('[JobDescriptions] list failed:', error)
    return res.status(500).json({ error: 'Unable to list job descriptions' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    await ensureSchema()
    const result = await pool.query(
      `SELECT * FROM job_descriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    return res.json({ item: mapRecord(result.rows[0]) })
  } catch (error) {
    console.error('[JobDescriptions] get failed:', error)
    return res.status(500).json({ error: 'Unable to fetch job description' })
  }
})

router.post('/', (req, res, next) => {
  upload.single('jdFile')(req, res, (error) => {
    if (!error) {
      return next()
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'JD file must be 20MB or smaller' })
    }

    return res.status(400).json({ error: error.message || 'Invalid file upload request' })
  })
}, async (req, res) => {
  try {
    await ensureSchema()

    const title = String(req.body.title || '').trim()

    if (!title) {
      return res.status(400).json({ error: 'title is required' })
    }

    const status = ['draft', 'active', 'archived'].includes(req.body.status)
      ? req.body.status
      : 'active'

    const fileUrl = req.file?.filename ? `/api/job-descriptions/files/${req.file.filename}` : null

    const result = await pool.query(
      `INSERT INTO job_descriptions (
         user_id,
         title,
         description,
         requirements,
         responsibilities,
         skills,
         experience_years,
         experience_min,
         experience_max,
         location,
         salary_min,
         salary_max,
         salary_currency,
         department,
         employment_type,
         additional_info,
         priority,
         archived_reason,
         source_type,
         version,
         file_url,
         status,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
       RETURNING *`,
      [
        req.userId,
        title,
        req.body.description || null,
        req.body.requirements || null,
        req.body.responsibilities || null,
        JSON.stringify(normalizeSkills(req.body.skills)),
        toIntOrNull(req.body.experienceYears),
        toIntOrNull(req.body.experienceMin),
        toIntOrNull(req.body.experienceMax),
        req.body.location || null,
        toIntOrNull(req.body.salaryMin),
        toIntOrNull(req.body.salaryMax),
        String(req.body.salaryCurrency || 'USD').trim().toUpperCase() || 'USD',
        req.body.department === undefined ? '' : String(req.body.department || '').trim(),
        req.body.employmentType === undefined ? 'unspecified' : String(req.body.employmentType || 'unspecified').trim(),
        req.body.additionalInfo || null,
        toIntOrDefault(req.body.priority, 0),
        req.body.archivedReason || null,
        req.body.sourceType === undefined ? 'manual' : String(req.body.sourceType || 'manual').trim(),
        toIntOrDefault(req.body.version, 1),
        fileUrl,
        status,
      ],
    )

    return res.status(201).json({ item: mapRecord(result.rows[0]) })
  } catch (error) {
    console.error('[JobDescriptions] create failed:', error)
    return res.status(500).json({ error: 'Unable to create job description' })
  }
})

router.put('/:id', (req, res, next) => {
  upload.single('jdFile')(req, res, (error) => {
    if (!error) {
      return next()
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'JD file must be 20MB or smaller' })
    }

    return res.status(400).json({ error: error.message || 'Invalid file upload request' })
  })
}, async (req, res) => {
  try {
    await ensureSchema()
    const existing = await pool.query(
      `SELECT * FROM job_descriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    const prev = existing.rows[0]
    const title = String(req.body.title || prev.title).trim()

    if (!title) {
      return res.status(400).json({ error: 'title is required' })
    }

    const status = ['draft', 'active', 'archived'].includes(req.body.status)
      ? req.body.status
      : prev.status

    const fileUrl = req.file?.filename
      ? `/api/job-descriptions/files/${req.file.filename}`
      : (req.body.fileUrl || prev.file_url)

    const result = await pool.query(
      `UPDATE job_descriptions
       SET title = $3,
           description = $4,
           requirements = $5,
           responsibilities = $6,
           skills = $7::jsonb,
           experience_years = $8,
           experience_min = $9,
           experience_max = $10,
           location = $11,
           salary_min = $12,
           salary_max = $13,
           salary_currency = $14,
           department = $15,
           employment_type = $16,
           additional_info = $17,
           priority = $18,
           archived_reason = $19,
           source_type = $20,
           version = $21,
           file_url = $22,
           status = $23,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        req.params.id,
        req.userId,
        title,
        req.body.description ?? prev.description,
        req.body.requirements ?? prev.requirements,
        req.body.responsibilities ?? prev.responsibilities,
        JSON.stringify(req.body.skills === undefined ? (Array.isArray(prev.skills) ? prev.skills : []) : normalizeSkills(req.body.skills)),
        req.body.experienceYears === undefined ? prev.experience_years : toIntOrNull(req.body.experienceYears),
        req.body.experienceMin === undefined ? prev.experience_min : toIntOrNull(req.body.experienceMin),
        req.body.experienceMax === undefined ? prev.experience_max : toIntOrNull(req.body.experienceMax),
        req.body.location === undefined ? prev.location : req.body.location,
        req.body.salaryMin === undefined ? prev.salary_min : toIntOrNull(req.body.salaryMin),
        req.body.salaryMax === undefined ? prev.salary_max : toIntOrNull(req.body.salaryMax),
        req.body.salaryCurrency === undefined
          ? (prev.salary_currency || 'USD')
          : (String(req.body.salaryCurrency || 'USD').trim().toUpperCase() || 'USD'),
        req.body.department === undefined ? prev.department : String(req.body.department || '').trim(),
        req.body.employmentType === undefined
          ? (prev.employment_type || 'unspecified')
          : (String(req.body.employmentType || 'unspecified').trim()),
        req.body.additionalInfo === undefined ? prev.additional_info : (req.body.additionalInfo || null),
        req.body.priority === undefined ? prev.priority : toIntOrDefault(req.body.priority, prev.priority),
        req.body.archivedReason === undefined ? prev.archived_reason : (req.body.archivedReason || null),
        req.body.sourceType === undefined
          ? (prev.source_type || 'manual')
          : (String(req.body.sourceType || 'manual').trim()),
        req.body.version === undefined ? prev.version : toIntOrDefault(req.body.version, prev.version),
        fileUrl,
        status,
      ],
    )

    return res.json({ item: mapRecord(result.rows[0]) })
  } catch (error) {
    console.error('[JobDescriptions] update failed:', error)
    return res.status(500).json({ error: 'Unable to update job description' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await ensureSchema()
    const hardDelete = String(req.query.hardDelete || 'false') === 'true'

    const usageResult = await pool.query(
      `SELECT COUNT(DISTINCT r.id)::int AS resume_count,
              COUNT(pj.id)::int AS parse_job_count
       FROM job_descriptions jd
       LEFT JOIN resumes r
         ON r.job_description_id = jd.id
        AND r.user_id = jd.user_id
       LEFT JOIN parse_jobs pj
         ON pj.resume_id = r.id
       WHERE jd.id = $1 AND jd.user_id = $2
       GROUP BY jd.id`,
      [req.params.id, req.userId],
    )

    const usageRow = usageResult.rows[0]
    if (!usageRow) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    const usageSummary = mapUsageSummary(usageRow)

    if (hardDelete) {
      if ((usageSummary?.resumeCount || 0) > 0 || (usageSummary?.parseJobCount || 0) > 0) {
        return res.status(409).json({
          error: 'Hard delete blocked because this job has linked resumes or analyses. Archive instead.',
          usageSummary,
        })
      }

      const deleted = await pool.query(
        `DELETE FROM job_descriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
        [req.params.id, req.userId],
      )

      if (!deleted.rows[0]) {
        return res.status(404).json({ error: 'Job description not found' })
      }

      return res.json({ ok: true, deleted: true, usageSummary })
    }

    const archived = await pool.query(
      `UPDATE job_descriptions
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.userId],
    )

    if (!archived.rows[0]) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    return res.json({ ok: true, archived: true, usageSummary })
  } catch (error) {
    console.error('[JobDescriptions] delete failed:', error)
    return res.status(500).json({ error: 'Unable to delete job description' })
  }
})

router.post('/:id/duplicate', async (req, res) => {
  try {
    await ensureSchema()
    const source = await pool.query(
      `SELECT * FROM job_descriptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    if (!source.rows[0]) {
      return res.status(404).json({ error: 'Job description not found' })
    }

    const sourceRow = source.rows[0]

    const duplicate = await pool.query(
      `INSERT INTO job_descriptions (
        user_id,
        title,
        description,
        requirements,
        responsibilities,
        skills,
        experience_years,
        location,
        salary_min,
        salary_max,
        salary_currency,
        department,
        employment_type,
        additional_info,
        priority,
        archived_reason,
        source_type,
        version,
        file_url,
        status,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'draft', NOW())
      RETURNING *`,
      [
        req.userId,
        `${sourceRow.title} (Copy)`,
        sourceRow.description,
        sourceRow.requirements,
        sourceRow.responsibilities,
        JSON.stringify(Array.isArray(sourceRow.skills) ? sourceRow.skills : []),
        sourceRow.experience_years,
        sourceRow.location,
        sourceRow.salary_min,
        sourceRow.salary_max,
        sourceRow.salary_currency || 'USD',
        sourceRow.department || '',
        sourceRow.employment_type || 'unspecified',
        sourceRow.additional_info || null,
        sourceRow.priority ?? 0,
        sourceRow.archived_reason || null,
        sourceRow.source_type || 'manual',
        sourceRow.version ?? 1,
        sourceRow.file_url,
      ],
    )

    return res.status(201).json({ item: mapRecord(duplicate.rows[0]) })
  } catch (error) {
    console.error('[JobDescriptions] duplicate failed:', error)
    return res.status(500).json({ error: 'Unable to duplicate job description' })
  }
})

export default router
