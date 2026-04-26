import fs from 'fs/promises'
import path from 'path'
import multer from 'multer'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { sanitizeFilename } from '../utils/sanitize.js'

const router = Router()
const uploadDirectory = path.join(process.cwd(), 'backend', 'uploads', 'job-descriptions')
const MAX_FILE_SIZE = 20 * 1024 * 1024
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
      ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'unspecified',
      ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS archived_reason TEXT,
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

    CREATE INDEX IF NOT EXISTS idx_resumes_job_description_id ON resumes(job_description_id);
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

function mapRecord(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    requirements: row.requirements || '',
    skills: Array.isArray(row.skills) ? row.skills : [],
    experienceYears: row.experience_years,
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
}

router.get('/files/:filename', async (req, res) => {
  try {
    await ensureSchema()
    const target = path.basename(req.params.filename)
    const filePath = path.join(uploadDirectory, target)
    return res.sendFile(filePath)
  } catch {
    return res.status(404).json({ error: 'File not found' })
  }
})

router.get('/', async (req, res) => {
  try {
    await ensureSchema()

    const includeArchived = String(req.query.includeArchived || 'false') === 'true'
    const result = await pool.query(
      `SELECT *
       FROM job_descriptions
       WHERE user_id = $1
         AND ($2::boolean = true OR status <> 'archived')
       ORDER BY updated_at ASC`,
      [req.userId, includeArchived],
    )

    return res.json({ items: result.rows.map(mapRecord) })
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
         skills,
         experience_years,
         location,
         salary_min,
         salary_max,
         salary_currency,
         department,
         employment_type,
         priority,
         archived_reason,
         source_type,
         version,
         file_url,
         status,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
       RETURNING *`,
      [
        req.userId,
        title,
        req.body.description || null,
        req.body.requirements || null,
        JSON.stringify(normalizeSkills(req.body.skills)),
        toIntOrNull(req.body.experienceYears),
        req.body.location || null,
        toIntOrNull(req.body.salaryMin),
        toIntOrNull(req.body.salaryMax),
        String(req.body.salaryCurrency || 'USD').trim().toUpperCase() || 'USD',
        req.body.department === undefined ? '' : String(req.body.department || '').trim(),
        req.body.employmentType === undefined ? 'unspecified' : String(req.body.employmentType || 'unspecified').trim(),
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
           skills = $6::jsonb,
           experience_years = $7,
           location = $8,
           salary_min = $9,
           salary_max = $10,
           salary_currency = $11,
           department = $12,
           employment_type = $13,
           priority = $14,
           archived_reason = $15,
           source_type = $16,
           version = $17,
           file_url = $18,
           status = $19,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        req.params.id,
        req.userId,
        title,
        req.body.description ?? prev.description,
        req.body.requirements ?? prev.requirements,
        JSON.stringify(req.body.skills === undefined ? (Array.isArray(prev.skills) ? prev.skills : []) : normalizeSkills(req.body.skills)),
        req.body.experienceYears === undefined ? prev.experience_years : toIntOrNull(req.body.experienceYears),
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

    if (hardDelete) {
      const deleted = await pool.query(
        `DELETE FROM job_descriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
        [req.params.id, req.userId],
      )

      if (!deleted.rows[0]) {
        return res.status(404).json({ error: 'Job description not found' })
      }

      return res.json({ ok: true, deleted: true })
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

    return res.json({ ok: true, archived: true })
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
        skills,
        experience_years,
        location,
        salary_min,
        salary_max,
        salary_currency,
        department,
        employment_type,
        priority,
        archived_reason,
        source_type,
        version,
        file_url,
        status,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft', NOW())
      RETURNING *`,
      [
        req.userId,
        `${sourceRow.title} (Copy)`,
        sourceRow.description,
        sourceRow.requirements,
        JSON.stringify(Array.isArray(sourceRow.skills) ? sourceRow.skills : []),
        sourceRow.experience_years,
        sourceRow.location,
        sourceRow.salary_min,
        sourceRow.salary_max,
        sourceRow.salary_currency || 'USD',
        sourceRow.department || '',
        sourceRow.employment_type || 'unspecified',
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
